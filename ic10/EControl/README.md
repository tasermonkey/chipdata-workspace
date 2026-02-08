Electronic Control
-----

## VC-IC Kitchen Bedroom EControl
[Source Code - Kitchen Bedroom](./VC-IC%20Kitchen%20Bedroom%20EControl.ic10)
[Source Code - Main Hall](./VC-IC%20Main%20Hall%20EControl.ic10)
These scripts mostly control lights in each room, based on occupancy detection
I kept a few examples here, because some of them are slightly different depending on specific setups (like treating 2 techinically different rooms as one.)

## VC-IC Fab Room EControl
[Source Code](./VC-IC%20Fab%20Room%20EControl.ic10)

This is like the other EControl scripts, but the printer room it also controls the printers on/off.

The printer on/off is configured in a way that it will turn off only after the printer is done printing whatever job its doing and no one is there.

This script for the printer/fab room goes well with the [FabControl](../FabControl/README.md) scripts.

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
[Source Code](./VCIC%20-%20Battery%20Control.ic10)

Oh Boy this is a complex one.  I was playing with the modular consoles.  Have a cool dashboard ![Battery Console](./image-Battery%20Control.png) 


- TODO: Split up into 2 smaller IC chips (WIP)
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

## Solar Power Controller
[Source Code](./MBA-Solar%20Power%20Controller.ic10)

This was grabbed from somewhere ... I got tired of figuring this out.  Anyways ... its pretty flexible.
- Face all panels the same direction (data ports/power ports all facing same cardinal direction)
- Light Sensor power port be facing the North.  (According to the compass mod)
- You can use a dial to manage offsets based on the direction you placed the the solar panels, or sensor.
- I like to keep my data and power wires seperated in this case, and the data be backed up by a APC backup
  that only powers the IC housing and dial.  (This way its easy to replace the battery if some how it drained before service, and your main batteries died)
- The power wire then goes to the main battery bank that would power the rest of the base.



