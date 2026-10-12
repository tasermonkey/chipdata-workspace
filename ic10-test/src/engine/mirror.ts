/**
 * The Logic Mirror (plan §5.4): a device on one data network that stands in for a target device on
 * another. Neither the emulator nor the Stationpedia export gives it logic types; its behaviour is
 * the game's `LogicMirror` (read from Assembly-CSharp.dll, 2026-10-11), which overrides only
 * CanLogicRead, GetLogicValue, CanLogicWrite and SetLogicValue, each passed to the target:
 * - with no target, nothing can be read or written, so `l` / `s` halt the chip (IncorrectLogicType);
 * - unpowered, the checks still pass but reads return 0 and writes are dropped;
 * - slot logic isn't passed on, and the mirror has no slots, so `ls` / `ss` halt the chip;
 * - `PrefabHash`, `ReferenceId` and `NameHash` are logic types like any other, so they're the target's;
 * - batch instructions and `ld` find devices by their own prefab, name and ID, so they see a Logic
 *   Mirror, not the target, and the target's ID isn't on the mirror's network.
 */
import { type Device, ErrorSeverity, Ic10Error } from "@tasermonkey/ic10";
import { CustomDevice, registerModPrefab } from "./device.ts";

export const MIRROR_PREFAB = "StructureLogicMirror";

/** The emulator's message when a mirror with no target is read or written; describe.ts rewrites it. */
export const NO_TARGET_MESSAGE = "Logic Mirror has no target device";

/** Errors a mirror passed on from its target, with the mirror they came through. */
export const mirroredErrors = new WeakMap<Ic10Error, LogicMirror>();

type Prop = number | string;

export class LogicMirror extends CustomDevice {
	/** The device it stands in for, or undefined (as built, before a screwdriver picks one). */
	target?: Device;
	/** Whether it has power (10 W in game). Unpowered, reads are 0 and writes are dropped. */
	powered: boolean;

	constructor(id: number) {
		// Its own logic types are only what the harness writes on every device; reads and writes from
		// instructions go through the hooks below.
		registerModPrefab({
			prefab: MIRROR_PREFAB,
			hash: 2096189278, // HASH("StructureLogicMirror"), as the Stationpedia export has it
			title: "Logic Mirror",
			logic: { PrefabHash: "r", ReferenceId: "r" },
			slots: [],
			modes: [],
			source: "mod",
		});
		super(id, MIRROR_PREFAB);
		this.powered = true;
		this.props!.hooks = {
			canLoad: (prop) => this.target?.props?.canLoad(prop) ?? false,
			canStore: (prop) => this.target?.props?.canStore(prop) ?? false,
			read: (prop) => this.read(prop),
			write: (prop, value) => this.write(prop, value),
		};
	}

	private read(prop: Prop): number {
		const target = this.target;
		if (!target) return this.noTarget();
		if (!this.powered && target.props?.canLoad(prop)) return 0;
		return this.passOn(target, () => target.props?.read(prop) ?? 0);
	}

	private write(prop: Prop, value: number): void {
		const target = this.target;
		if (!target) {
			this.noTarget();
			return;
		}
		if (!this.powered && target.props?.canStore(prop)) return;
		this.passOn(target, () => target.props?.write(prop, value));
	}

	private noTarget(): number {
		this.errors.add(new Ic10Error({ message: NO_TARGET_MESSAGE, severity: ErrorSeverity.Strong }));
		return 0;
	}

	/**
	 * Run a read or write on the target, then move any error it raised onto the mirror: a chip only
	 * collects errors from devices on its own network. The error still names the target.
	 */
	private passOn<T>(target: Device, run: () => T): T {
		const before = target.errors.get();
		const result = run();
		const raised = target.errors.get().filter((error) => !before.includes(error));
		if (raised.length > 0) {
			target.errors.reset();
			for (const error of before) target.errors.add(error);
			for (const error of raised) {
				this.errors.add(error);
				error.setDevice(target);
				mirroredErrors.set(error, this);
			}
		}
		return result;
	}
}
