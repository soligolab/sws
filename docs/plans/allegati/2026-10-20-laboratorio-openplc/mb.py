import socket,struct,sys,time
def req(fc,data,tid=[0]):
    tid[0]+=1
    s=socket.create_connection(("127.0.0.1",1502),timeout=3)
    pdu=bytes([fc])+data
    s.send(struct.pack(">HHHB",tid[0],0,len(pdu)+1,1)+pdu)
    r=s.recv(260); s.close(); return r[7:]
def coils(a,n): r=req(1,struct.pack(">HH",a,n)); return [(r[2]>>i)&1 for i in range(n)]
def regs(a,n): r=req(3,struct.pack(">HH",a,n)); return list(struct.unpack(">"+"h"*n,r[2:2+2*n]))
def wcoil(a,v): req(5,struct.pack(">HH",a,0xFF00 if v else 0))
print("coils",coils(0,3),"regs",regs(0,3))
wcoil(0,1); time.sleep(3)
print("dopo marcia: coils",coils(0,3),"regs",regs(0,3))
