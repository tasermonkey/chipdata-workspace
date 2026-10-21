# DS-8 Server Rack scripts

Scripts in here need the [DS-8 Server Rack](https://steamcommunity.com/sharedfiles/filedetails/?id=3819662919)
mod. They run in the rack's processor sockets rather than in an IC housing, so they don't work
without it. Each folder is one setup:

| Folder | What it runs |
| --- | --- |
| [FurnaceControl](./FurnaceControl/README.md) | An Advanced Furnace, with its recipes on a drive. AdvFurnaceControl, rebuilt for the rack. |
| [Audit](./Audit/README.md) | In-game tests of what those scripts assume about the rack, the console parts and the furnace. |

## What the rack changes

- **`db` is the rack.** `get` and `put` on `db` reach the drives and the rack's status registers. A
  chip's own stack (`push`, `pop`) is still its own.
- **Devices are on I/O ports.** The rack has 32. A script reads a port's device ID from the rack's
  memory and uses it with `ld` and `sd`, so the ports are set in game rather than in the script.
- **Chips share memory.** Every chip in the rack can read and write the drives and eight scratch
  cells. That's how the chips of one setup talk to each other.
- **Addresses** assume the mod's default drive size of 512 cells. The status registers start at
  8 × DriveCapacity (4096), with the port IDs at 4128-4135 (ports 1-8) and 4160-4183 (ports 9-32),
  and the scratch cells at 4136-4143.

Each script has a `<script>.ic10.json` saying `"host": "StructureServerRack"`, so `npm test` runs
it in a rack.
