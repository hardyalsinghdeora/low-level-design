import { SignalColor } from '../signal';

/**
 * State pattern for one signal head. Each state knows its only legal
 * successor, so GREEN can never jump straight to RED and skip the yellow.
 */
export interface LightState {
  readonly color: SignalColor;
  next(): LightState;
}

class GreenState implements LightState {
  readonly color = SignalColor.GREEN;
  next(): LightState {
    return YELLOW_STATE;
  }
}

class YellowState implements LightState {
  readonly color = SignalColor.YELLOW;
  next(): LightState {
    return RED_STATE;
  }
}

class RedState implements LightState {
  readonly color = SignalColor.RED;
  next(): LightState {
    return GREEN_STATE;
  }
}

export const GREEN_STATE: LightState = new GreenState();
export const YELLOW_STATE: LightState = new YellowState();
export const RED_STATE: LightState = new RedState();
