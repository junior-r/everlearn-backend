export const AVAILABLE_LABS = Symbol('AvailableLabs');

/**
 * The labs an institution's members may open: granted by a Platform Admin and
 * left on by the Institution Admin. Lets other modules (the classroom) ask
 * without depending on how Labs stores either decision.
 */
export interface AvailableLabs {
  /** The keys of the available labs, in catalogue order. */
  keysFor(institutionId: string): Promise<string[]>;
}
