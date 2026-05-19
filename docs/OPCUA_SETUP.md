# OPC-UA Client Setup

> **Status (BL-005 step 1+2+3+4)**: Reads (subscriptions), writes (via
> `TagWriteBus`), and one-level server browse all work end-to-end against
> a server that accepts anonymous or username/password auth with security
> policy `None`. Certificate-based security and Euromap companion-spec
> auto-discovery (BL-005b) are deferred follow-ups — see `STATUS.md`.

The SWS runtime ships with a built-in OPC-UA client plugin
(`sws-plugin-opcua`, version-locked to `async-opcua` 0.18). It runs as a
background task inside the runtime — no extra container, no extra
process. Configure one or more endpoints in `project.yaml` (or via
**Configurazione → Protocolli → + Aggiungi OPC-UA** in the editor), and
the runtime opens a subscription, streams every monitored node into the
`TagDb`, and reconnects on its own after 5 s if the server drops.

## Project YAML shape

```yaml
sources:
  - kind: opcua_client
    id: machine1
    endpoint_url: "opc.tcp://192.168.1.100:4840"
    security_policy: "None"           # PoC: only "None" is wired
    auth: { kind: anonymous }          # or username_password (see below)
    subscription_interval_ms: 500
    nodes:
      - tag: machine1.cycle_time
        node_id: "ns=2;s=Machine.CycleTime"
        description: Tempo ciclo (s)
      - tag: machine1.parts_produced
        node_id: "ns=2;s=Machine.PartsProduced"
```

### Authentication options

```yaml
auth: { kind: anonymous }

auth:
  kind: username_password
  username: operator
  password: secret123        # for the demo
  # OR — and preferred for any non-toy deployment:
  password_env: SWS_OPCUA_PWD
```

`password_env` always wins over `password` so secrets can stay out of the
YAML on disk. Set the env var when launching the runtime
(e.g. `SWS_OPCUA_PWD=… ./scripts/dev.sh`).

### NodeId format

Standard OPC-UA strings — the runtime parses them with
`NodeId::from_str`:

| Form                      | Meaning                                        |
|---------------------------|------------------------------------------------|
| `ns=0;i=2253`             | Numeric id in namespace 0 (Server object)      |
| `ns=2;s=Machine.CycleTime`| String id in namespace 2                       |
| `ns=2;g=...uuid...`       | GUID id (less common on industrial servers)    |

The namespace number depends on the server. A discovery / browse endpoint
is on the roadmap (BL-005 step 4); for now point an OPC-UA viewer at the
server (UaExpert, Prosys OPC UA Browser, `opcua-commander`) to list
NodeIds.

### Subscription interval

`subscription_interval_ms` becomes the server-side **PublishingInterval**
on the subscription. Set it to the smallest value that gives you the
update rate you want — most industrial servers cap at ~100 ms. Default
500 ms; minimum clamped to 50 ms by the plugin.

### Tag quality propagation

- Server reports `StatusCode::Good` → `TagQuality::Good`.
- Server reports any other status → `TagQuality::Bad`.
- Variant value missing → `TagQuality::Uncertain`.
- Plugin disconnect → every mapped tag flipped to `Bad` until the next
  data-change callback arrives after reconnect.

### Supported value types

Boolean, all integer widths (Byte / SByte / Int16 / UInt16 / Int32 /
UInt32 / Int64 / UInt64), Float, Double, String, LocalizedText. Anything
else lands in the TagDb with `TagQuality::Uncertain` so the UI flags it
without crashing the dispatcher.

## Testing locally with a simulator

You don't need real PLC hardware to test the integration. Two popular
free simulators:

### 1. `node-opcua` example server

Lightweight, scriptable, runs in Node.js:

```sh
npx node-opcua-server-example
```

Default endpoint: `opc.tcp://localhost:26543/UA/MyLittleServer`. The
example exposes `ns=1;s=Temperature`, `ns=1;s=Pressure`, etc. — point an
SWS OpcUaClient source at it with `nodes: [{ tag: "demo.temp", node_id: "ns=1;s=Temperature" }, …]`.

### 2. Prosys OPC UA Simulation Server (free, GUI)

<https://www.prosysopc.com/products/opc-ua-simulation-server/>

Default endpoint: `opc.tcp://<host>:53530/OPCUA/SimulationServer`.
Exposes a rich set of simulated counters, sinewaves, etc. NodeIds are
visible in the GUI's address-space browser.

## Smoke-test recipe

```sh
# Terminal A — runtime + editor
./scripts/dev.sh both

# Terminal B — simulator (example)
npx node-opcua-server-example

# Browser: https://localhost:5173
# 1. Login as admin/admin
# 2. Configurazione → Protocolli → "+ Aggiungi OPC-UA"
# 3. Endpoint URL: opc.tcp://localhost:26543/UA/MyLittleServer
# 4. Add a Nodo row — tag: demo.temp, NodeId: ns=1;s=Temperature
# 5. Crea il tag con "＋" se non esiste
# 6. Salva
# 7. Drop a Trend or Gauge on a synoptic, bind it to demo.temp,
#    switch to View mode — values should start streaming.
```

The runtime logs the connection lifecycle at INFO level:

```
opcua: connecting
opcua: connected, creating subscription
opcua: subscribed (count=N)
```

## Writes back to the server (step 4)

Each tag listed in `OpcUaClientConfig.nodes` is automatically registered
on the runtime's `TagWriteBus`. Any `PUT /api/tags/<tag>` or `/ws/tags`
write frame for one of those tags is converted into an OPC-UA `Write`
service call on the configured NodeId.

Value type mapping for writes:

| TagValue | Sent as           |
|----------|-------------------|
| `Bool`   | `Variant::Boolean`|
| `Int`    | `Variant::Int64`  |
| `Float`  | `Variant::Double` |
| `Str`    | `Variant::String` |

If the server returns `StatusCode::Good` the plugin echoes the new
value into the local `TagDb` immediately (so the UI doesn't have to
wait for the next subscription publish). Any other status is logged
and the local value stays at whatever the server reports next.

The server side is responsible for type coercion if a tag's natural
type doesn't line up with the underlying node's data type — most
industrial servers accept the closest convertible scalar.

## Browse the server (step 3)

`POST /api/sources/opcua/browse` (Operator+) opens a temporary OPC-UA
session, walks **one level** under the requested `parent_node_id`
(defaults to the Objects folder, `ns=0;i=85`), and returns the immediate
children:

```json
{
  "endpoint_url": "opc.tcp://localhost:26543/UA/MyLittleServer",
  "source_id":    "machine1",   // for masked-password resolution
  "auth":         { "kind": "anonymous" },
  "parent_node_id": "ns=2;s=Machine"   // optional; omit for root
}
```

```json
{
  "nodes": [
    { "node_id": "ns=2;s=Machine.CycleTime",
      "browse_name": "CycleTime", "display_name": "CycleTime",
      "node_class": "Variable" },
    …
  ]
}
```

Recursion is on the caller — the editor expands a folder by issuing a
fresh browse with that folder's NodeId. Keeps responses small and
avoids server-side fan-out timeouts.

**In the editor**: open a source card → click **🔍 Sfoglia server**.
A tree appears. Click an `Object` to expand it (lazy-load); tick a
`Variable` to add it to the import selection; click **Importa**.
The selected NodeIds are appended to the source's node table with their
`display_name` pre-filled as the description — you still set the SWS
`tag` field yourself (or click `＋` next to it to create the tag inline).
`Variable` rows that are already in the import list are greyed out so
you can't double-add.

## What's still deferred

- **Security policies other than `None`**. The `security_policy` field
  travels through to YAML for forward-compat and is logged when set, but
  the plugin always negotiates `None` for the PoC.
- **Euromap companion spec auto-discovery**. Tracked as BL-005b in
  STATUS.md.
- **Reverse browse** (References pointing *into* a node). The current
  endpoint only walks Forward / HierarchicalReferences — the common case
  for inspecting an address space.

When any of these become a customer-facing requirement we'll graduate
the implementation; the existing `OpcUaClientConfig` shape is designed
to stay stable across that work.
