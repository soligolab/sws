# Pixsys Modbus RTU / TCP Register Map Reference Manual

This document outlines the detailed Modbus register tables for Pixsys controllers, indicators, signal converters, and remote I/O modules (e.g., ATR series, STR series, MCM series, DRR series). 

---

## 1. Protocol Specifications & General Rules

* **Communication Protocol**: Modbus RTU / Modbus TCP
* **Baud Rate (Default)**: 19200 bps (Configurable: 4800, 9600, 19200, 28800, 38400, 57600, 115200 bps)
* **Parity / Framing**: 8 Data Bits, No Parity, 1 Stop Bit (8-N-1) by default
* **Supported Function Codes**:
  * `03 (0x03)`: Read Holding Registers
  * `04 (0x04)`: Read Input Registers
  * `06 (0x06)`: Write Single Register
  * `16 (0x10)`: Write Multiple Registers
* **Data Types**:
  * `INT16`: 16-bit Signed Integer
  * `UINT16`: 16-bit Unsigned Integer
  * `BITFIELD`: 16-bit Register with individual bit flags

---

## 2. Common Register Map (Shared Across Pixsys Devices)

The following registers are located in standard memory locations shared by most Pixsys devices (ATR121/142/244, STR571, DRR245, MCM260, etc.).

| Register (Dec) | Register (Hex) | Access | Data Type | Description / Notes | Scale / Unit |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **0** | `0x0000` | R | UINT16 | **Device ID / Model Code** | Numeric code identifying the device |
| **1** | `0x0001` | R | UINT16 | **Firmware Revision** | e.g., `100` = v1.00 |
| **2** | `0x0002` | R/W | UINT16 | **Slave Modbus Address** | Range: `1 - 247` |
| **3** | `0x0003` | R/W | UINT16 | **Baud Rate Code** | `0` = 4800, `1` = 9600, `2` = 19200, `3` = 38400, `4` = 57600, `5` = 115200 |
| **4** | `0x0004` | R/W | UINT16 | **Parity & Stop Bits** | `0` = 8-N-1, `1` = 8-E-1, `2` = 8-O-1, `3` = 8-N-2 |
| **5** | `0x0005` | R/W | UINT16 | **Serial Delay** | Response delay in milliseconds (`0 - 100 ms`) |

---

## 3. Process Controllers (ATR Series: ATR144 / ATR244 / ATR121)

### 3.1 Process & Dynamic Variables (Read-Only / Operational)

| Register (Dec) | Register (Hex) | Access | Data Type | Parameter | Description | Scale / Unit |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1000** | `0x03E8` | R | INT16 | **PV1** | Process Variable AI1 (Main Input) | According to `Dec.P` (e.g., 100 = 10.0 °C) |
| **1001** | `0x03E9` | R | INT16 | **PV2** | Process Variable AI2 (Auxiliary Input) | According to `Dec.P` |
| **1002** | `0x03EA` | R | INT16 | **Active Setpoint**| Currently active control target | According to `Dec.P` |
| **1003** | `0x03EB` | R | INT16 | **Power Output** | Output percentage | `-100.0% to +100.0%` (0.1% res) |
| **1004** | `0x03EC` | R | BITFIELD | **Status Word** | System operating state | See Bitmask below |
| **1005** | `0x03ED` | R | BITFIELD | **Alarm Word** | Active alarms status | See Alarm Bitmask |

#### Status Word (Register 1004) Bit Structure:
* **Bit 0**: Alarm 1 Active
* **Bit 1**: Alarm 2 Active
* **Bit 2**: Alarm 3 Active
* **Bit 3**: Alarm 4 Active
* **Bit 4**: Heating Output Active
* **Bit 5**: Cooling Output Active
* **Bit 8**: Tune In Progress
* **Bit 9**: Manual Mode Active (`1` = Manual, `0` = Auto)
* **Bit 10**: Sensor 1 Open/Error
* **Bit 11**: Sensor 2 Open/Error

---

### 3.2 Setpoints & Operating Command Registers

| Register (Dec) | Register (Hex) | Access | Data Type | Parameter | Description | Scale / Range |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **2000** | `0x07D0` | R/W | INT16 | **SP1** | Main Control Setpoint 1 | Min.SP to Max.SP |
| **2001** | `0x07D1` | R/W | INT16 | **SP2** | Secondary Setpoint 2 | Min.SP to Max.SP |
| **2002** | `0x07D2` | R/W | INT16 | **Manual Power** | Manual output value (when in Manual mode)| `-1000 to 1000` (-100.0% to 100.0%) |
| **2003** | `0x07D3` | R/W | UINT16 | **Control Mode**| Mode selection | `0` = Stop/Standby, `1` = Auto, `2` = Manual |
| **2004** | `0x07D4` | R/W | UINT16 | **Tune Command**| Autotuning trigger | `0` = Off, `1` = Start Automatic Tuning |

---

## 4. Indicators & Remote Displays (STR Series: STR551 / STR561 / STR571)

### 4.1 Process Variables & Display Data

| Register (Dec) | Register (Hex) | Access | Data Type | Description | Scale / Format |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **100** | `0x0064` | R | INT16 | **Main Analog Input Value** | Value scaled based on input range |
| **101** | `0x0065` | R | INT16 | **Potentiometer Input Value** | Native value or scaled percentage |
| **102** | `0x0066` | R | UINT16 | **Digital Inputs Status** | Bit 0: DI1, Bit 1: DI2, Bit 2: DI3 |
| **103** | `0x0067` | R | UINT16 | **Relay Outputs Status** | Bit 0: Out 1, Bit 1: Out 2 |
| **104** | `0x0068` | R/W | INT16 | **Remote Variable 1** | Remote data register for master/slave display |
| **105** | `0x0069` | R/W | INT16 | **Remote Variable 2** | Remote data register for master/slave display |

---

## 5. DIN Rail Expansion & Remote I/O Modules (MCM Series: MCM260X / MCM280X)

### 5.1 Digital & Analog Inputs / Outputs Map

| Register (Dec) | Register (Hex) | Access | Data Type | Description | Bit / Range Details |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **10** | `0x000A` | R | BITFIELD | **Digital Inputs Word** | Bit 0..15 = State of DI0 to DI15 (`1` = ON, `0` = OFF) |
| **20** | `0x0014` | R/W | BITFIELD | **Digital Outputs Command** | Bit 0..15 = Command DO0 to DO15 (`1` = Active, `0` = Inactive) |
| **30** | `0x001E` | R | INT16 | **Analog Input 1 (AI1)** | `0 - 10000` (for 0-10V or 0-20mA), or `10x °C` for TC/RTD |
| **31** | `0x001F` | R | INT16 | **Analog Input 2 (AI2)** | Raw or scaled analog signal value |
| **32** | `0x0020` | R | INT16 | **Analog Input 3 (AI3)** | Raw or scaled analog signal value |
| **33** | `0x0021` | R | INT16 | **Analog Input 4 (AI4)** | Raw or scaled analog signal value |
| **40** | `0x0028` | R/W | INT16 | **Analog Output 1 (AO1)** | `0 - 10000` corresponding to 0..10V or 0/4..20mA |
| **41** | `0x0029` | R/W | INT16 | **Analog Output 2 (AO2)** | `0 - 10000` corresponding to 0..10V or 0/4..20mA |

---

## 6. Din-Rail Indicators & Signal Converters (DRR Series: DRR245 / DRR460)

| Register (Dec) | Register (Hex) | Access | Data Type | Description | Scale / Unit |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **500** | `0x01F4` | R | INT16 | **Converted Value Input 1** | Formatted process value |
| **501** | `0x01F5` | R | INT16 | **Converted Value Input 2** | Formatted process value |
| **502** | `0x01F6` | R | UINT16 | **Retransmission Output Value** | Raw DAC value for retransmission output |
| **510** | `0x01FE` | R/W | INT16 | **Alarm 1 Threshold** | Setpoint value for Alarm 1 |
| **511** | `0x01FF` | R/W | INT16 | **Alarm 2 Threshold** | Setpoint value for Alarm 2 |

---

## 7. Data Format & Multi-Register Encoding

### 32-bit Floating Point Encoding (IEEE 754)
When handling 32-bit floating point values (where supported by models like MCM280X or CNV520), two consecutive 16-bit registers are used.

* **Big-Endian (AB CD)**:
  * Register N: High Word (AB)
  * Register N+1: Low Word (CD)
* **Little-Endian Word Swap (CD AB)** (Default for most Pixsys systems):
  * Register N: Low Word (CD)
  * Register N+1: High Word (AB)

---

## 8. Exception & Error Codes

If a Modbus master requests an invalid register address or write command, Pixsys devices return standard Modbus exception responses:

| Exception Code | Error Name | Description |
| :--- | :--- | :--- |
| **0x01** | Illegal Function | The function code received is not supported by the slave. |
| **0x02** | Illegal Data Address | The register address requested is out of range or forbidden. |
| **0x03** | Illegal Data Value | The written value is outside permissible parameter boundaries. |
| **0x06** | Slave Device Busy | Device is undergoing internal operations (e.g., flash memory write). |