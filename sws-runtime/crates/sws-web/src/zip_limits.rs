//! Reading a zip archive that comes from outside, with a ceiling
//! (18-11-2026, CRA session 2, plan `docs/plans/2026-11-18-cra-2-isolamento-cloud-e-sandbox.md`).
//!
//! The bodies of the uploads are bounded (8 MiB, 32 MiB for the PLC logic), but
//! deflate expands about a thousand times: a project bundle of a few megabytes
//! could become gigabytes in memory and on disk. On a Tiny TY, with 235 MB of
//! RAM, far less is enough to stop the runtime.
//!
//! Three checks, used together:
//! - [`open`], before the archive is parsed: the directory may declare no more
//!   than [`MAX_ENTRIES`] entries. Parsing builds one record per entry, and a
//!   32 MiB upload can declare some hundred thousand of them;
//! - [`check`], once it is open: the sizes the archive **declares** stay
//!   within a budget proportional to its compressed size;
//! - [`read_entry`], for every entry read: at most the size it declared, and
//!   never more than [`MAX_ENTRY_BYTES`]. An entry that lies about its size is
//!   an error, so the declared sizes that [`check`] added up are the real
//!   ones.

use std::io::{Cursor, Read};

/// More entries than any real project has (pages, images, recipes, logic).
pub const MAX_ENTRIES: usize = 10_000;

/// What an archive may expand to, in total, whatever its size.
pub const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;

/// What a single entry may expand to, even where [`check`] did not run.
pub const MAX_ENTRY_BYTES: u64 = 32 * 1024 * 1024;

/// Expansion allowed per compressed byte: the YAML of a project compresses
/// about six times, images not at all.
const RATIO: u64 = 8;

/// A small archive may always expand to this much.
const FLOOR_BYTES: u64 = 16 * 1024 * 1024;

/// The total an archive of `compressed_len` bytes may expand to.
pub fn budget(compressed_len: usize) -> u64 {
    (compressed_len as u64)
        .saturating_mul(RATIO)
        .saturating_add(FLOOR_BYTES)
        .min(MAX_TOTAL_BYTES)
}

/// The most entries any end-of-directory record in the tail of `bytes`
/// declares. Every candidate counts, not only the one the zip reader will
/// pick: a signature can also appear inside the comment.
fn declared_entries(bytes: &[u8]) -> u64 {
    const EOCD: &[u8] = b"PK\x05\x06";
    const ZIP64_LOCATOR: &[u8] = b"PK\x06\x07";
    const ZIP64_EOCD: &[u8] = b"PK\x06\x06";
    let u16_at = |at: usize| -> Option<u64> {
        bytes
            .get(at..at + 2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]) as u64)
    };
    let u64_at = |at: usize| -> Option<u64> {
        bytes
            .get(at..at + 8)
            .map(|b| u64::from_le_bytes(b.try_into().unwrap_or_default()))
    };
    if bytes.len() < 22 {
        return 0;
    }
    let lowest = bytes.len().saturating_sub(22 + u16::MAX as usize);
    let mut most = 0u64;
    for at in (lowest..=bytes.len() - 22).rev() {
        if &bytes[at..at + 4] != EOCD {
            continue;
        }
        let mut n = u16_at(at + 10).unwrap_or(0);
        if n == u16::MAX as u64 {
            // Zip64: the real count is in the zip64 record the locator points
            // to. One that cannot be followed keeps the 65 535 it says.
            let zip64 = at
                .checked_sub(20)
                .filter(|&l| bytes.get(l..l + 4) == Some(ZIP64_LOCATOR))
                .and_then(|l| u64_at(l + 8))
                .and_then(|r| usize::try_from(r).ok())
                .filter(|&r| bytes.get(r..r + 4) == Some(ZIP64_EOCD))
                .and_then(|r| u64_at(r + 32));
            if let Some(z) = zip64 {
                n = n.max(z);
            }
        }
        most = most.max(n);
    }
    most
}

/// The archive in `bytes`, open and within limits, or the reason it is not,
/// to show as it is.
pub fn open(bytes: &[u8]) -> Result<zip::ZipArchive<Cursor<&[u8]>>, String> {
    let declared = declared_entries(bytes);
    if declared > MAX_ENTRIES as u64 {
        return Err(format!(
            "the archive declares {declared} entries, more than the {MAX_ENTRIES} allowed"
        ));
    }
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("not a valid zip: {e}"))?;
    check(&mut archive, bytes.len())?;
    Ok(archive)
}

/// Whether an archive made here (an export, a deploy) will be accepted by an
/// import or a deploy on the other side: `None` if it will, or the reason,
/// to say before it leaves (decision D11, maintainer's request of
/// 18-11-2026). `body_limit` is the largest upload the other side reads.
pub fn will_be_refused(bytes: &[u8], body_limit: usize) -> Option<String> {
    if bytes.len() > body_limit {
        return Some(format!(
            "the archive is {:.1} MB, and an import or a deploy accepts at most {} MB",
            bytes.len() as f64 / (1024.0 * 1024.0),
            body_limit / (1024 * 1024)
        ));
    }
    open(bytes).err()
}

/// The archive is within limits, or the reason it is not, to show as it is.
pub fn check<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    compressed_len: usize,
) -> Result<(), String> {
    if archive.len() > MAX_ENTRIES {
        return Err(format!(
            "the archive has {} entries, more than the {MAX_ENTRIES} allowed",
            archive.len()
        ));
    }
    let limit = budget(compressed_len);
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let entry = archive.by_index_raw(i).map_err(|e| e.to_string())?;
        total = total.saturating_add(entry.size());
        if total > limit {
            return Err(format!(
                "the archive expands to more than {} MB: refused",
                limit / (1024 * 1024)
            ));
        }
    }
    Ok(())
}

/// The content of an entry, no longer than the size it declares.
pub fn read_entry(entry: &mut zip::read::ZipFile<'_, impl Read>) -> std::io::Result<Vec<u8>> {
    let declared = entry.size();
    if declared > MAX_ENTRY_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "{}: expands to more than {} MB",
                entry_name(entry),
                MAX_ENTRY_BYTES / (1024 * 1024)
            ),
        ));
    }
    let mut buf = Vec::with_capacity(declared.min(FLOOR_BYTES) as usize);
    entry
        .take(declared.saturating_add(1))
        .read_to_end(&mut buf)?;
    if buf.len() as u64 > declared {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{}: larger than it declares", entry_name(entry)),
        ));
    }
    Ok(buf)
}

fn entry_name(entry: &zip::read::ZipFile<'_, impl Read>) -> String {
    entry.name().map(|n| n.into_owned()).unwrap_or_default()
}

/// [`read_entry`] as text.
pub fn read_entry_text(entry: &mut zip::read::ZipFile<'_, impl Read>) -> std::io::Result<String> {
    String::from_utf8(read_entry(entry)?)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_of(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opt = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries {
            w.start_file(*name, opt).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    /// A real bundle passes and reads back the same bytes.
    #[test]
    fn a_normal_archive_passes() {
        let z = zip_of(&[("project.yaml", b"meta:\n  name: x\n".to_vec())]);
        let mut a = open(&z).unwrap();
        let mut e = a.by_name("project.yaml").unwrap();
        assert_eq!(read_entry_text(&mut e).unwrap(), "meta:\n  name: x\n");
        assert_eq!(declared_entries(&z), 1);
    }

    /// Two hundred megabytes of zeros compress to a few hundred kilobytes:
    /// refused when the archive is opened, before anything is expanded.
    #[test]
    fn an_archive_that_swells_is_refused() {
        let z = zip_of(&[("bomb.yaml", vec![0u8; 200 * 1024 * 1024])]);
        assert!(z.len() < 1024 * 1024, "{}", z.len());
        let e = open(&z).unwrap_err();
        assert!(e.contains("refused"), "{e}");
        // And an entry read without the check still stops at its ceiling.
        let mut a = zip::ZipArchive::new(Cursor::new(z.as_slice())).unwrap();
        let mut f = a.by_index(0).unwrap();
        let e = read_entry(&mut f).unwrap_err().to_string();
        assert!(e.contains("bomb.yaml") && e.contains("MB"), "{e}");
    }

    /// Refused from the count its directory declares, before it is parsed.
    #[test]
    fn too_many_entries_are_refused_before_parsing() {
        let entries: Vec<(String, Vec<u8>)> = (0..=MAX_ENTRIES)
            .map(|i| (format!("f{i}"), Vec::new()))
            .collect();
        let refs: Vec<(&str, Vec<u8>)> = entries
            .iter()
            .map(|(n, d)| (n.as_str(), d.clone()))
            .collect();
        let z = zip_of(&refs);
        assert_eq!(declared_entries(&z), MAX_ENTRIES as u64 + 1);
        assert!(open(&z).unwrap_err().contains("declares"));
        let mut a = zip::ZipArchive::new(Cursor::new(z.as_slice())).unwrap();
        assert!(check(&mut a, z.len()).unwrap_err().contains("entries"));
    }

    /// A count that only an end record hidden in the comment declares is
    /// counted too, and so is the zip64 one.
    #[test]
    fn every_end_record_counts() {
        let mut z = zip_of(&[("a", b"x".to_vec())]);
        // Comment length (last two bytes of the real record), then a fake
        // record with 60 000 entries inside the comment.
        let mut fake = b"PK\x05\x06".to_vec();
        fake.extend_from_slice(&[0, 0, 0, 0]);
        fake.extend_from_slice(&60_000u16.to_le_bytes());
        fake.extend_from_slice(&60_000u16.to_le_bytes());
        fake.extend_from_slice(&[0; 10]);
        let n = z.len();
        z[n - 2..].copy_from_slice(&(fake.len() as u16).to_le_bytes());
        z.extend_from_slice(&fake);
        assert_eq!(declared_entries(&z), 60_000);
        assert!(open(&z).is_err());
        assert_eq!(declared_entries(b"PK\x05\x06"), 0);
        assert_eq!(declared_entries(b""), 0);
    }

    /// An archive made here is checked with the rules of the side that will
    /// read it: the size of the upload first, then the entries and the budget.
    #[test]
    fn an_archive_made_here_says_if_it_will_be_refused() {
        let z = zip_of(&[("project.yaml", b"meta: {}\n".to_vec())]);
        assert_eq!(will_be_refused(&z, 1024 * 1024), None);
        let e = will_be_refused(&z, 10).unwrap();
        assert!(e.contains("accepts at most"), "{e}");
        let bomb = zip_of(&[("bomb.yaml", vec![0u8; 100 * 1024 * 1024])]);
        assert!(will_be_refused(&bomb, 8 * 1024 * 1024)
            .unwrap()
            .contains("refused"));
    }

    #[test]
    fn the_budget_grows_with_the_archive_and_stops() {
        assert_eq!(budget(0), FLOOR_BYTES);
        assert_eq!(budget(1024 * 1024), 8 * 1024 * 1024 + FLOOR_BYTES);
        assert_eq!(budget(6 * 1024 * 1024), MAX_TOTAL_BYTES);
        assert_eq!(budget(usize::MAX), MAX_TOTAL_BYTES);
    }
}
