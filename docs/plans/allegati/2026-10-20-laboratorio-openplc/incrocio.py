import asyncio, time, snap7
from snap7.util import get_int, get_bool
from asyncua import Client, ua
async def main():
    async with Client("opc.tcp://127.0.0.1:14840/openplc/opcua") as cl:
        n = cl.get_node("ns=2;s=impianto.comando_marcia")
        await n.write_value(ua.DataValue(ua.Variant(True, ua.VariantType.Boolean)))
        print("OPC scritto comando_marcia = True")
        await asyncio.sleep(4)
        print("OPC livello =", await cl.get_node("ns=2;s=impianto.livello").read_value())
asyncio.run(main())
c = snap7.client.Client(); c.connect("127.0.0.1", 0, 1, 10102)
db1 = c.db_read(1, 0, 6); db2 = c.db_read(2, 0, 1)
print("S7  livello", get_int(db1,0), "soglia", get_int(db1,2), "portata", get_int(db1,4), "| pompa", get_bool(db2,0,1))
