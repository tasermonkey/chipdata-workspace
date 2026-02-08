# Food Control

## Grow Lights
[Source Code](./Grow%20Lights.ic10)

Simple grow light controller.  Simple script that just uses the sun's position in the sky to time the on/off schedule of the lights.  Not perfect, but simple.

## Larre Controller
[Source Code](./Larre%20Controller.ic10)

A controller that makes the larre go around picking plants as they are needed to be picked, and then replanting.  This was a first pass at this.  Because its hard to control seed/plant, this has 2 requirements, one the plant is always fully mature and seed is ready.  And 2, it will always replant the seed.  (even though we could have more plantings if we didn't wait for the seed).  Also, it will always pick everything, which means the seed ends up in its 'off hand'(the small 1 item storage slot of the larre) and all of the harvest in its main hand.  Then it will go to a station, and activate until the entire harvest is emptied.  As far as I know, this station must be a powered import chute (or something else that functions as that).   Once its empties the hand, the seed will remain then it goes back to the original plant location and places the seed into the planter.  This does nothing with fertilizer, as I haven't even experiment with that.  Its not as efficient as it could be (N*N trips for harvesting/planting), however, if you place the chute import in the middle of its batch of plants, it will half the distance it has to repeat on average.  I did this by have it manage a few rows, and putting the chute in the center row.
  
  - The comment out DEBUG_# are just LEDs that I had placed so that I could see it (came from the Original Debug script)
  - Future run improvements may be: Scan first (look for all mature plants, and pick their seeds).  

## Larre Controller debug
[Source Code](./Larree%20Controller%20Debug.ic10)

This was just me trying to figure out how to do things with it.  Nothing useful.