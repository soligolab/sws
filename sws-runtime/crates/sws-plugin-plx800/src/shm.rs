//! The shared segment of the PLX800-IO module, `/dev/shm/qmb800_registers`.
//!
//! Interface version 1, 176 bytes, little-endian, natural alignment. The
//! layout and the access rules are those of the public reference
//! (`/home/ut1/Git/openplc/docs/interface/`, verified on a PLX800 on
//! 2026-10-29): the status area is protected by a sequence counter, the
//! command area is the **complete** desired state and is published by
//! incrementing `cmd_seq` last.

use std::{
    fs::{File, OpenOptions},
    mem::offset_of,
    os::{fd::AsRawFd, unix::fs::MetadataExt},
    path::Path,
    ptr::NonNull,
    sync::atomic::{fence, AtomicU32, Ordering},
};

pub const SHM_PATH: &str = "/dev/shm/qmb800_registers";
pub const LOCK_PATH: &str = "/dev/shm/qmb800_registers.lock";

pub const MAGIC: u32 = 0x314D_4251; // "QBM1"
pub const VERSION: u32 = 1;
pub const SIZE: usize = 176;

pub const COIL_COUNT: usize = 17;
pub const COIL_BYTES: usize = 3;
pub const DI_BYTES: usize = 2;
pub const IR_COUNT: usize = 18;
pub const HR_COUNT: usize = 12;

/// The image of the module: read-back of the coils, discrete inputs, input
/// registers, read-back of the holding registers.
#[repr(C)]
struct RawImage {
    coils: [u8; COIL_BYTES],
    di: [u8; DI_BYTES],
    ir: [u16; IR_COUNT],
    hr: [u16; HR_COUNT],
}

/// The whole segment, as `lib/c/qmb800_client.h` declares it.
#[repr(C)]
struct RawShm {
    magic: u32,
    version: u32,
    struct_size: u32,
    reserved0: u32,
    cmd_seq: u32,
    cmd_apply: u32,
    cmd_coils: [u8; COIL_BYTES],
    cmd_hr: [u16; HR_COUNT],
    reserved1: u32,
    status_seq: u32,
    update_count: u64,
    timestamp_ns: u64,
    cycle_us: u32,
    last_ok: u32,
    reserved_status0: u32,
    reserved_status1: u32,
    fail_count: u64,
    image: RawImage,
}

// The offsets of the reference, checked at compile time: a field moved by
// mistake would read the wrong register without any other sign.
const _: () = {
    assert!(offset_of!(RawShm, cmd_seq) == 16);
    assert!(offset_of!(RawShm, cmd_apply) == 20);
    assert!(offset_of!(RawShm, cmd_coils) == 24);
    assert!(offset_of!(RawShm, cmd_hr) == 28);
    assert!(offset_of!(RawShm, status_seq) == 56);
    assert!(offset_of!(RawShm, update_count) == 64);
    assert!(offset_of!(RawShm, cycle_us) == 80);
    assert!(offset_of!(RawShm, last_ok) == 84);
    assert!(offset_of!(RawShm, fail_count) == 96);
    assert!(offset_of!(RawShm, image) == 104);
    assert!(std::mem::size_of::<RawImage>() == 66);
    assert!(std::mem::size_of::<RawShm>() == SIZE);
};

const OFF_CMD_SEQ: usize = offset_of!(RawShm, cmd_seq);
const OFF_CMD_APPLY: usize = offset_of!(RawShm, cmd_apply);
const OFF_CMD_COILS: usize = offset_of!(RawShm, cmd_coils);
const OFF_CMD_HR: usize = offset_of!(RawShm, cmd_hr);
const OFF_STATUS: usize = offset_of!(RawShm, status_seq);
const STATUS_LEN: usize = SIZE - OFF_STATUS;

/// A consistent copy of the status area.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Snapshot {
    pub update_count: u64,
    pub cycle_us: u32,
    pub last_ok: bool,
    pub fail_count: u64,
    pub coils: [u8; COIL_BYTES],
    pub di: [u8; DI_BYTES],
    pub ir: [u16; IR_COUNT],
    pub hr: [u16; HR_COUNT],
}

impl Snapshot {
    /// Decodes the status area (offsets 56..176, little-endian).
    fn decode(b: &[u8; STATUS_LEN]) -> Snapshot {
        // Offsets relative to the start of the status area.
        let at = |abs: usize| abs - OFF_STATUS;
        let u32_at = |abs: usize| u32::from_le_bytes(b[at(abs)..at(abs) + 4].try_into().unwrap());
        let u64_at = |abs: usize| u64::from_le_bytes(b[at(abs)..at(abs) + 8].try_into().unwrap());
        let img = at(offset_of!(RawShm, image));
        let mut s = Snapshot {
            update_count: u64_at(offset_of!(RawShm, update_count)),
            cycle_us: u32_at(offset_of!(RawShm, cycle_us)),
            last_ok: u32_at(offset_of!(RawShm, last_ok)) == 1,
            fail_count: u64_at(offset_of!(RawShm, fail_count)),
            ..Default::default()
        };
        s.coils.copy_from_slice(&b[img..img + COIL_BYTES]);
        s.di.copy_from_slice(&b[img + 3..img + 3 + DI_BYTES]);
        let ir0 = img + offset_of!(RawImage, ir);
        for (i, v) in s.ir.iter_mut().enumerate() {
            *v = u16::from_le_bytes([b[ir0 + 2 * i], b[ir0 + 2 * i + 1]]);
        }
        let hr0 = img + offset_of!(RawImage, hr);
        for (i, v) in s.hr.iter_mut().enumerate() {
            *v = u16::from_le_bytes([b[hr0 + 2 * i], b[hr0 + 2 * i + 1]]);
        }
        s
    }

    pub fn coil(&self, n: usize) -> bool {
        bit(&self.coils, n)
    }

    pub fn di(&self, n: usize) -> bool {
        bit(&self.di, n)
    }
}

pub fn bit(bytes: &[u8], n: usize) -> bool {
    bytes.get(n / 8).is_some_and(|b| b & (1 << (n % 8)) != 0)
}

pub fn set_bit(bytes: &mut [u8], n: usize, on: bool) {
    if let Some(b) = bytes.get_mut(n / 8) {
        if on {
            *b |= 1 << (n % 8);
        } else {
            *b &= !(1 << (n % 8));
        }
    }
}

/// The complete desired state of every writable point.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Command {
    pub coils: [u8; COIL_BYTES],
    pub hr: [u16; HR_COUNT],
}

impl Command {
    /// The command that leaves everything as it is now.
    pub fn from_readback(s: &Snapshot) -> Command {
        Command {
            coils: s.coils,
            hr: s.hr,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum OpenError {
    /// The file is not there: no module, or the system is still starting.
    Missing,
    /// The file exists but the layout is not the one this code knows.
    Layout(String),
    Io(String),
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpenError::Missing => write!(f, "segment {SHM_PATH} not found"),
            OpenError::Layout(e) => write!(f, "unexpected segment layout: {e}"),
            OpenError::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for OpenError {}

/// A mapping of the segment.
pub struct Segment {
    ptr: NonNull<u8>,
    writable: bool,
    /// Device and inode of the mapped file: the system service removes the
    /// file when it stops and creates a new one when it starts.
    id: (u64, u64),
    // Kept for the lifetime of the mapping (not strictly needed after mmap).
    _file: File,
}

// The mapping is plain shared memory: every access goes through volatile or
// atomic operations, so moving it to another thread is fine.
unsafe impl Send for Segment {}
unsafe impl Sync for Segment {}

impl Segment {
    /// Maps the segment at `path`, read only or read/write, and checks the
    /// header.
    pub fn open(path: &Path, writable: bool) -> Result<Segment, OpenError> {
        let file = OpenOptions::new()
            .read(true)
            .write(writable)
            .open(path)
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => OpenError::Missing,
                _ => OpenError::Io(format!("{}: {e}", path.display())),
            })?;
        let md = file.metadata().map_err(|e| OpenError::Io(e.to_string()))?;
        let len = md.len();
        let id = (md.dev(), md.ino());
        if len < SIZE as u64 {
            return Err(OpenError::Layout(format!("{len} bytes, expected {SIZE}")));
        }
        let prot = if writable {
            libc::PROT_READ | libc::PROT_WRITE
        } else {
            libc::PROT_READ
        };
        // SAFETY: a shared mapping of an open file, of a length the file has.
        let p = unsafe {
            libc::mmap(
                std::ptr::null_mut(),
                SIZE,
                prot,
                libc::MAP_SHARED,
                file.as_raw_fd(),
                0,
            )
        };
        if p == libc::MAP_FAILED {
            return Err(OpenError::Io(format!(
                "mmap {}: {}",
                path.display(),
                std::io::Error::last_os_error()
            )));
        }
        let seg = Segment {
            ptr: NonNull::new(p as *mut u8).expect("mmap returned null"),
            writable,
            id,
            _file: file,
        };
        let (magic, version, size) = (seg.read_u32(0), seg.read_u32(4), seg.read_u32(8));
        if magic != MAGIC || version != VERSION || size as usize != SIZE {
            return Err(OpenError::Layout(format!(
                "magic {magic:#010x}, version {version}, struct_size {size}"
            )));
        }
        Ok(seg)
    }

    /// Whether `path` still names the file this mapping was made from. When the
    /// service restarts, the old mapping stays valid but never moves again.
    pub fn is_still_at(&self, path: &Path) -> bool {
        std::fs::metadata(path).is_ok_and(|m| (m.dev(), m.ino()) == self.id)
    }

    fn read_u32(&self, off: usize) -> u32 {
        // SAFETY: `off` is inside the 176 mapped bytes and 4-aligned.
        unsafe { std::ptr::read_volatile(self.ptr.as_ptr().add(off) as *const u32) }
    }

    fn atomic_u32(&self, off: usize) -> &AtomicU32 {
        // SAFETY: inside the mapping, 4-aligned, and shared with other
        // processes only through atomic or volatile accesses.
        unsafe { &*(self.ptr.as_ptr().add(off) as *const AtomicU32) }
    }

    /// A consistent copy of the status area, or `None` if the system kept
    /// updating it during 100 attempts (never seen: one try is the norm).
    pub fn read(&self) -> Option<Snapshot> {
        let seq = self.atomic_u32(OFF_STATUS);
        for _ in 0..100 {
            let s1 = seq.load(Ordering::Acquire);
            if s1 % 2 == 1 {
                std::hint::spin_loop();
                continue;
            }
            fence(Ordering::SeqCst);
            // SAFETY: the status area lies inside the mapping.
            let bytes: [u8; STATUS_LEN] = unsafe {
                std::ptr::read_volatile(self.ptr.as_ptr().add(OFF_STATUS) as *const [u8; STATUS_LEN])
            };
            fence(Ordering::SeqCst);
            if seq.load(Ordering::Acquire) == s1 {
                return Some(Snapshot::decode(&bytes));
            }
        }
        None
    }

    /// The current command sequence number.
    pub fn cmd_seq(&self) -> u32 {
        self.atomic_u32(OFF_CMD_SEQ).load(Ordering::Acquire)
    }

    /// Publishes `cmd` and returns the new `cmd_seq`. The sequence number is
    /// the last store, after a full barrier: the system applies the command
    /// when it sees it change.
    pub fn commit(&self, cmd: &Command) -> u32 {
        assert!(self.writable, "commit on a read-only mapping");
        let base = self.ptr.as_ptr();
        // SAFETY: all offsets are inside the mapping; volatile stores of
        // plain bytes.
        unsafe {
            for (i, b) in cmd.coils.iter().enumerate() {
                std::ptr::write_volatile(base.add(OFF_CMD_COILS + i), *b);
            }
            for (i, v) in cmd.hr.iter().enumerate() {
                for (j, b) in v.to_le_bytes().iter().enumerate() {
                    std::ptr::write_volatile(base.add(OFF_CMD_HR + 2 * i + j), *b);
                }
            }
            std::ptr::write_volatile(base.add(OFF_CMD_APPLY) as *mut u32, 1u32.to_le());
        }
        fence(Ordering::SeqCst);
        let seq = self.atomic_u32(OFF_CMD_SEQ);
        let next = seq.load(Ordering::Acquire).wrapping_add(1);
        seq.store(next, Ordering::Release);
        next
    }
}

impl Drop for Segment {
    fn drop(&mut self) {
        // SAFETY: the mapping created in `open`, of that length.
        unsafe {
            libc::munmap(self.ptr.as_ptr() as *mut libc::c_void, SIZE);
        }
    }
}

/// The single-writer lock: an exclusive `flock` on the lock file, held for as
/// long as the value lives and released by the kernel if the process dies.
pub struct WriterLock {
    _file: File,
}

impl WriterLock {
    /// Takes the lock without waiting. `Ok(None)` = another writer holds it.
    pub fn try_take(path: &Path) -> std::io::Result<Option<WriterLock>> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)?;
        // Other runtimes (OpenPLC, the reference libraries) open it read/write
        // as another user: a umask-reduced mode would lock them out.
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = file.set_permissions(std::fs::Permissions::from_mode(0o666));
        }
        // SAFETY: flock on an fd we own.
        let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if rc == 0 {
            return Ok(Some(WriterLock { _file: file }));
        }
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() == Some(libc::EWOULDBLOCK) {
            Ok(None)
        } else {
            Err(err)
        }
    }
}

#[cfg(test)]
pub(crate) mod fake {
    //! A file with the layout of the segment, for tests: the part the system
    //! writes is filled here.
    use super::*;
    use std::{io::Write, path::PathBuf};

    pub struct Fake {
        pub dir: PathBuf,
        pub path: PathBuf,
    }

    impl Fake {
        pub fn new(tag: &str) -> Fake {
            let dir = std::env::temp_dir().join(format!(
                "sws-plx800-{tag}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("qmb800_registers");
            let f = Fake { dir, path };
            f.create();
            f
        }

        /// A new file with the header filled, as the service makes it when it
        /// starts.
        pub fn create(&self) {
            let mut b = vec![0u8; SIZE];
            b[0..4].copy_from_slice(&MAGIC.to_le_bytes());
            b[4..8].copy_from_slice(&VERSION.to_le_bytes());
            b[8..12].copy_from_slice(&(SIZE as u32).to_le_bytes());
            std::fs::File::create(&self.path)
                .unwrap()
                .write_all(&b)
                .unwrap();
            self.set_u32(offset_of!(RawShm, cycle_us), 1000);
            self.set_u32(offset_of!(RawShm, last_ok), 1);
        }

        /// The service stops: it removes the file. A mapping of it stays valid.
        pub fn remove(&self) {
            std::fs::remove_file(&self.path).unwrap();
        }

        /// In place, never truncating: the file is mapped, and a mapping past
        /// the end of a file is a SIGBUS.
        fn patch(&self, off: usize, bytes: &[u8]) {
            use std::os::unix::fs::FileExt;
            let f = std::fs::OpenOptions::new()
                .write(true)
                .open(&self.path)
                .unwrap();
            f.write_all_at(bytes, off as u64).unwrap();
        }

        pub fn set_u32(&self, off: usize, v: u32) {
            self.patch(off, &v.to_le_bytes());
        }

        pub fn set_status_seq(&self, v: u32) {
            self.set_u32(OFF_STATUS, v);
        }

        pub fn set_update_count(&self, v: u64) {
            self.patch(offset_of!(RawShm, update_count), &v.to_le_bytes());
        }

        pub fn set_cmd_seq(&self, v: u32) {
            self.set_u32(OFF_CMD_SEQ, v);
        }

        pub fn set_image(&self, coils: [u8; 3], di: [u8; 2], ir: [u16; 18], hr: [u16; 12]) {
            let img = offset_of!(RawShm, image);
            let mut b = Vec::new();
            b.extend_from_slice(&coils);
            b.extend_from_slice(&di);
            b.push(0); // padding before the u16 registers
            for v in ir {
                b.extend_from_slice(&v.to_le_bytes());
            }
            for v in hr {
                b.extend_from_slice(&v.to_le_bytes());
            }
            self.patch(img, &b);
        }

        pub fn bytes(&self) -> Vec<u8> {
            std::fs::read(&self.path).unwrap()
        }

        pub fn cmd(&self) -> (u32, u32, [u8; 3], [u16; 12]) {
            let b = self.bytes();
            let u32_at = |o: usize| u32::from_le_bytes(b[o..o + 4].try_into().unwrap());
            let mut coils = [0u8; 3];
            coils.copy_from_slice(&b[OFF_CMD_COILS..OFF_CMD_COILS + 3]);
            let mut hr = [0u16; 12];
            for (i, v) in hr.iter_mut().enumerate() {
                *v = u16::from_le_bytes([b[OFF_CMD_HR + 2 * i], b[OFF_CMD_HR + 2 * i + 1]]);
            }
            (u32_at(OFF_CMD_SEQ), u32_at(OFF_CMD_APPLY), coils, hr)
        }
    }

    impl Drop for Fake {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::Fake;
    use super::*;

    #[test]
    fn a_missing_segment_is_reported_as_missing() {
        let p = std::env::temp_dir().join("sws-plx800-surely-missing");
        assert_eq!(Segment::open(&p, false).err(), Some(OpenError::Missing));
    }

    #[test]
    fn a_wrong_header_is_refused() {
        let f = Fake::new("header");
        f.set_u32(4, 2); // version 2
        match Segment::open(&f.path, false) {
            Err(OpenError::Layout(e)) => assert!(e.contains("version 2"), "{e}"),
            other => panic!("expected a layout error, got {:?}", other.err()),
        }
    }

    #[test]
    fn the_status_area_is_decoded_at_the_reference_offsets() {
        let f = Fake::new("decode");
        let mut ir = [0u16; 18];
        ir[0] = 4950; // VCAP mV
        ir[5] = 313; // 40 °C
        ir[6] = 1;
        ir[7] = 2; // DIAG_RX_TOTAL = 0x0001_0002
        let mut hr = [0u16; 12];
        hr[0] = 1;
        hr[11] = 1000;
        f.set_image(
            [0b0000_0101, 0b1000_0000, 0b1],
            [0b0000_1000, 0b0000_0001],
            ir,
            hr,
        );
        f.set_update_count(42);
        let seg = Segment::open(&f.path, false).unwrap();
        let s = seg.read().unwrap();
        assert_eq!(s.update_count, 42);
        assert_eq!(s.cycle_us, 1000);
        assert!(s.last_ok);
        assert!(s.coil(0) && !s.coil(1) && s.coil(2) && s.coil(15) && s.coil(16));
        assert!(s.di(3) && s.di(8));
        assert_eq!(s.ir[0], 4950);
        assert_eq!(s.ir[5], 313);
        assert_eq!((s.ir[6], s.ir[7]), (1, 2));
        assert_eq!(s.hr[0], 1);
        assert_eq!(s.hr[11], 1000);
    }

    #[test]
    fn an_update_in_progress_is_never_returned() {
        let f = Fake::new("odd");
        f.set_status_seq(7); // odd: the system is writing
        let seg = Segment::open(&f.path, false).unwrap();
        assert_eq!(seg.read(), None);
        f.set_status_seq(8);
        assert!(seg.read().is_some());
    }

    #[test]
    fn commit_writes_the_whole_command_and_increments_the_sequence_last() {
        let f = Fake::new("commit");
        f.set_cmd_seq(41);
        let seg = Segment::open(&f.path, true).unwrap();
        let mut hr = [0u16; 12];
        hr[1] = 0x0F;
        hr[4] = 500;
        let cmd = Command {
            coils: [0b1010_0001, 0b0000_0001, 0b1],
            hr,
        };
        assert_eq!(seg.commit(&cmd), 42);
        let (seq, apply, coils, hr_read) = f.cmd();
        assert_eq!(seq, 42);
        assert_eq!(apply, 1);
        assert_eq!(coils, cmd.coils);
        assert_eq!(hr_read, cmd.hr);
        assert_eq!(seg.cmd_seq(), 42);
    }

    #[test]
    fn the_writer_lock_is_exclusive() {
        let f = Fake::new("lock");
        let lock = f.dir.join("lock");
        let first = WriterLock::try_take(&lock).unwrap();
        assert!(first.is_some());
        // A second open file description: flock refuses it even in-process.
        assert!(WriterLock::try_take(&lock).unwrap().is_none());
        drop(first);
        assert!(WriterLock::try_take(&lock).unwrap().is_some());
    }

    #[test]
    fn bits_are_lsb_first() {
        let mut b = [0u8; 3];
        set_bit(&mut b, 0, true);
        set_bit(&mut b, 9, true);
        set_bit(&mut b, 16, true);
        assert_eq!(b, [0b1, 0b10, 0b1]);
        set_bit(&mut b, 9, false);
        assert_eq!(b, [0b1, 0, 0b1]);
        assert!(bit(&b, 16) && !bit(&b, 17) && !bit(&b, 99));
    }
}
