Climate Control
------------
## Vulcan Climate Control
[Source](./VC-Coolant-Setup.md)

This script setup (and hardware) is to be able to take the 'cool' (relatively) night gas, seperate out the pollutants (so that it easier to manage, with the added benefit of it being slightly cooler), then using phase change with it, keep the base cool enough.  By the end, I needed upwards of 4 of these setups to keep up with the base being fully atmosphered.

This is probably actually considered a couple of phases, as I am going from gas(Atmo) -> liquid(pollutants) -> gas (The heat exchange waste port being warmed up) -> (closed loop here between phase change devices) liquid/gas -> expansion champer -> base air.
The base air then was put into AC units to keep the base ultimately cool. 

## MBA - Filter Controller MKI
[Source](./MBA%20-%20Filter%20Controller%20MKI.ic10)
Moon base alpha Filter controller.  I put this in one of each filteration device to filter out the waste gas into different tanks (one for each gas).  Our waste is from both the return air supply of the base, as well as furnace waste gas.  So it could get hot.  So this expects the waste gas to be cooled by a cooling system prior to filtering.  So this script turns off their own filter (via setting the mode) until the units are cool enough.  It also requires a set amount of pressure to ensure I am getting the most out of the filters.  I varied this amount though out the play through, based on other uses for the waste gas ... since I was cooling the waste with radiators, it was also used as a coolant to keep the base at temp too.  So I wanted enough mass in the pipe system to keep the base tempature from changing quickly.  We ended up using a heat exchanger to keep another CO2 pipeline at root tempature so that the waste line didn't need to be the one cooling the base, so if something burst, it wouldn't pollute our base.  And we had a easy emergency shutoff, if something didn't work.

Anyways MKI cause this is prior to me trying to automate changing of the filters.
