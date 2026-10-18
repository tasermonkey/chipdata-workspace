Setup instructions
===
## Required hardware
1. Console mod (not required, optional but makes it looks nice and easier to setup)
2. 2 Console Mod Displays (or Consoles for LED / Percentage view)
3. 5 Console Mod Inputs
   - 2 Buttons -> +/- 10 for amounts
   - 1 Amount Dial -> For manual input, how many to print... Configure max to some number like 500, to have a max amount of items to be able to print
   - 1 Mode Flip Switch (To switch between manual and stack mode)
   - 1 On/Off switch (so that the machine may function like normal)
4. 2 IC Housing (though 1 is used only for setup and may be removed/turned off when done)
    - 1 IC Housing/Chip - [controller chip](./Printer%20Control.ic10)        - The actual code to control the fabrication room
    - 1 IC Housing/Chip - [configuration chip](./Printer%20Setup.ic10) - To tell the other chip what fabricatorto control
5. All devices on 1 logistical data network
6. 1 stacker per fabricator
7. Tablet with the Configuration Chip
    - This way you can identify all of the devices

## Hardware example Pic
![Labeled View](./with-tablet.png)
![Unmarked View](./view-unmarked.png)

## Software Setup
1. Install the controller chip:
- Add the [controller chip](./Printer%20Control.ic10) to the housing.
- Optionally name the housing so that you can easily find it for the setup chip
2. The setup chip is:
- [View Code](./Printer%20Setup.ic10) 
- Memory Should reference the code chip.  It changes the 'stack' of the code chip with the items under control of that controller chip
    - In the setup code, the `$<string>` means the "ReferenceId" (If you use the ReferenceId in the tablet that already has the dollar you add the dollar sign, if you use the decimal number version of ReferenceId, you do not need the `$` (just match what the tablet says)
```
alias Memory d0

put Memory 0 2 # number of fabricators <<<< YOU NEED TO EDIT THIS TO HOW MANY YOU HAVE >>>>

# fabricator 1 (Autolathe1)
put Memory 1 $1488 # Printer (12)
put Memory 2 $3606 # Stacker (11)
put Memory 3 $AE16A # Progress display (10)
put Memory 4 $AE19B # Amount display (9)
put Memory 5 $AE87A # Power input (8)
put Memory 6 $AEF03 # Input amount (7)
put Memory 7 $AE0D8 # Input stack toggle (6)
put Memory 8 $AEEEA # Plus 10 button (5)
put Memory 9 $AEEF9 # Minus 10 button (4)
put Memory 10 $AEF03  # Input amount (3)
put Memory 11 0     # Selected Amount (2)
put Memory 12 0     # Reserve for productionMode (1)
######
### Continue for each fabricator, each one taking 12 'memory' slots.
### So the next one will start at 13 and end at 24
### If you have more than can fit on a chip you can just make a new chip
### and start where you left off in the index (some multiple of 12) + 1
```

- If the controller chip stops with an error, a device in the setup is wrong (or was rebuilt with a new ID). The line it stopped on says which: each `jal getDeviceAt` looks one up, after `move Param1 N`, and N is the device's place counted back from the end of its block of 12. Fix the setup, rerun it, and then maybe take the controller chip out and put it back in.

| N  | Device             | Setup slot |
|----|--------------------|------------|
| 12 | Printer            | 1          |
| 11 | Stacker            | 2          |
| 10 | Progress display   | 3          |
| 9  | Amount display     | 4          |
| 8  | Power input        | 5          |
| 6  | Input stack toggle | 7          |
| 3  | Input amount       | 10         |

The plus and minus buttons (slots 8 and 9) are read in `scanButtons`.

