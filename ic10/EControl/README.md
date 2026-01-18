Electronic Control
-----
These scripts mostly control lights in each room, based on occupancy detection
The printer room it also controls the printers on/off.

The printer on/off is configured in a way that it will turn off only after the printer is done printing whatever job its doing and no one is there.

This script for the printer/fab room goes well with the [FabControl](../FabControl/README.md) scripts.

I kept a few examples here, because some of them are slightly different depending on specific setups (like treating 2 techinically different rooms as one.)

## Fab Control Setup
You will have to edit the Fab Control script to have the IDs of the printers to which it controls and monitors.
Script: [VC-IC Fab Room EControl](./VC-IC%20Fab%20Room%20EControl.ic10)
```
#move sp 1 #Enter tank or pipe analyzer names and prefabs below.
push 0

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
Oh Boy this is a complex one.
- TODO: Split up into 2 smaller IC chips
- Right now because of the code size only works with mods that allow for larger scripts
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
