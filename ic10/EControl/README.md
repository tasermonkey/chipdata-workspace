Electronic Control
-----

## Room Lights
[Source Code](./Room%20Lights.ic10)

Turns a room's lights on while someone is in it, based on occupancy detection. One script for every room:
- An occupancy sensor on d0, and optionally a second on d1 (for treating 2 technically different rooms as one).
- Name the room's lights, and set `ROOM_LIGHT` at the top of the script to that name: a different name for each room, so one room's chip leaves another room's lights alone.

## Fab Room EControl
[Source Code](./Fab%20Room%20EControl.ic10)

This is like the other EControl scripts, but the printer room it also controls the printers on/off.

The printer on/off is configured in a way that it will turn off only after the printer is done printing whatever job its doing and no one is there.

This script for the printer/fab room goes well with the [FabControl](../FabControl/README.md) scripts.

## Fab Control Setup
You will have to edit the Fab Control script to have the IDs of the printers to which it controls and monitors.
Script: [Fab Room EControl](./Fab%20Room%20EControl.ic10)
```
push 0 # the machines' IDs, between here and the poke (see the README)
push $1486 # authlathe1
push $1488 # authlathe2
push $2217 # pipe bender 1
push $2235 # pipe bender 2
push $482A # Toolbench
push $6E4F # Recycle
push $2736 # Electronics printer 1
push $279C # Electronics printer 2
poke 0 sp #Save TOS
```
Only edit the lines between the first `push 0` and the `poke`.  You may use the `${id}` hex version or the the pure `Decimal` version.

## Battery Control
[Source Code - Battery Control](./Battery%20Control.ic10)
[Source Code - Power Controller Battery](./Power%20Controller%20Battery.ic10)

Oh Boy this is a complex one.  I was playing with the modular consoles.  Have a cool dashboard ![Battery Console](./image-Battery%20Control.png) 

It runs on 2 IC chips, since it was too big for one:
- Power Controller Battery: runs the coal generators (charging the batteries from 20% to 80%), the Low Coal warning, and the battery charge displays.
- Battery Control: the generation and usage displays, the Power Delta gauge, and the transformer.

- Required names:
- Any Names / type StationBatteryNuclear
- Any Names / type StructureWindTurbine
- Any Names / type StructureSolidFuelGenerator
- Power Usage / type ModularDeviceLEDdisplay3
- Battery Charge Per / type ModularDeviceSliderDiode2
- Base CA / type StructureCableAnalysizer
- Power Delta / ModularDeviceGauge3x3
- Low Coal / type ModularDeviceLabelDiode3
- Coal Chute Low Marker / type StructureChuteDigitalValveRight  (you may need to change this) 
- TransformerPoweredUp Light / type LightDiod
- Transformer Throttle / type ModularDeviceThrottle3x2
- Stored Power Display / ModularDeviceLEDdisplay3
- Primary Transformer / StructureTransformer
- Transformer Output Value / ModularDeviceLEDdisplay2
- Battery Storage Gauge / type ModularDeviceGauge3x3

## Solar Power Controller
[Source Code](./Solar%20Power%20Controller.ic10)

This was grabbed from somewhere ... I got tired of figuring this out.  Anyways ... its pretty flexible.
- Face all panels the same direction (data ports/power ports all facing same cardinal direction)
- Light Sensor power port be facing the North.  (According to the compass mod)
- You can use a dial to manage offsets based on the direction you placed the the solar panels, or sensor.
- I like to keep my data and power wires seperated in this case, and the data be backed up by a APC backup
  that only powers the IC housing and dial.  (This way its easy to replace the battery if some how it drained before service, and your main batteries died)
- The power wire then goes to the main battery bank that would power the rest of the base.



