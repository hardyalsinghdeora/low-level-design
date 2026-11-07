import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import {
  ALL_DIRECTIONS,
  CycleStage,
  Direction,
  DisplayBoard,
  FixedTimingPlan,
  Intersection,
  IntersectionController,
  InvalidSignalTransitionError,
  InvalidTimingError,
  NoPreemptionActiveError,
  PedestrianSignal,
  PedestrianState,
  PerDirectionTimingPlan,
  PreemptionActiveError,
  SignalColor,
  TrafficLight,
} from './index';

const { NORTH: N, SOUTH: S, EAST: E, WEST: W } = Direction;
const { GREEN, YELLOW, RED } = SignalColor;

function build(clock = new FakeClock('2026-03-01T08:00:00Z')) {
  const controller = new IntersectionController(new Intersection('Main & 5th'), {
    timing: new FixedTimingPlan({ green: 30, yellow: 5, allRed: 2 }),
    clock,
  });
  return { controller, snap: () => controller.intersection.snapshot(), clock };
}

/** Park-Miller LCG: deterministic "random" emergencies for the invariant test. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 48_271) % 2_147_483_647) / 2_147_483_647;
}

describe('TrafficLight state', () => {
  it('only allows GREEN -> YELLOW -> RED -> GREEN', () => {
    const light = new TrafficLight(N);
    expect(light.color).toBe(RED);
    expect(() => light.changeTo(YELLOW)).toThrow(InvalidSignalTransitionError);
    light.changeTo(GREEN);
    expect(() => light.changeTo(RED)).toThrow(InvalidSignalTransitionError);
    expect(light.changeTo(YELLOW)).toBe(GREEN);
  });
});

describe('IntersectionController cycle', () => {
  it('starts with north-south green and east-west red', () => {
    const { snap } = build();
    expect(snap()).toEqual({ NORTH: GREEN, SOUTH: GREEN, EAST: RED, WEST: RED });
  });

  it('runs green, yellow, all-red clearance, then the next phase', () => {
    const { controller, snap } = build();
    controller.tick(29);
    expect(snap()[N]).toBe(GREEN);
    controller.tick(1);
    expect(snap()).toMatchObject({ NORTH: YELLOW, SOUTH: YELLOW, EAST: RED });
    controller.tick(5);
    expect(Object.values(snap())).toEqual([RED, RED, RED, RED]);
    expect(controller.currentStage).toBe(CycleStage.ALL_RED);
    controller.tick(2);
    expect(snap()).toEqual({ NORTH: RED, SOUTH: RED, EAST: GREEN, WEST: GREEN });
    controller.tick(37);
    expect(controller.currentGreen).toEqual([N, S]);
  });

  it('one big tick equals many small ticks', () => {
    const a = build().controller;
    const b = build().controller;
    a.tick(250);
    for (let i = 0; i < 250; i++) b.tick(1);
    expect(a.intersection.snapshot()).toEqual(b.intersection.snapshot());
    expect(a.now.toISOString()).toBe(b.now.toISOString());
  });

  it('never lets conflicting directions move at the same time', () => {
    const { controller, snap } = build();
    const rng = lcg(42);
    for (let second = 0; second < 2_000; second++) {
      const r = rng();
      if (!controller.activePreemption && r < 0.01) controller.preempt(ALL_DIRECTIONS[Math.floor(rng() * 4)] ?? N);
      else if (controller.activePreemption && r > 0.95) controller.clearPreemption();
      controller.tick(1);
      const moving = ALL_DIRECTIONS.filter((d) => snap()[d] !== RED);
      const axes = new Set(moving.map((d) => (d === N || d === S ? 'NS' : 'EW')));
      expect(axes.size).toBeLessThanOrEqual(1);
    }
  });

  it('uses per-direction timings for a busy main road', () => {
    const main = { green: 45, yellow: 5, allRed: 2 };
    const side = { green: 20, yellow: 4, allRed: 2 };
    const controller = new IntersectionController(new Intersection('X'), {
      timing: new PerDirectionTimingPlan({ NORTH: main, SOUTH: main, EAST: side, WEST: side }),
    });
    controller.tick(44);
    expect(controller.intersection.light(N).color).toBe(GREEN);
    controller.tick(1 + 5 + 2 + 20);
    expect(controller.intersection.light(E).color).toBe(YELLOW);
  });

  it('rejects invalid timings', () => {
    expect(() => new FixedTimingPlan({ green: 0, yellow: 5, allRed: 2 })).toThrow(InvalidTimingError);
    expect(() => new FixedTimingPlan({ green: 30, yellow: 5, allRed: -1 })).toThrow(InvalidTimingError);
  });

  it('sync() ticks by the injected clock', () => {
    const { controller, clock, snap } = build();
    clock.advanceSeconds(32);
    controller.sync();
    expect(snap()[N]).toBe(YELLOW);
    expect(controller.now.toISOString()).toBe('2026-03-01T08:00:32.000Z');
  });
});

describe('Emergency preemption', () => {
  it('cuts a conflicting green short, gives only the emergency direction green and holds it', () => {
    const { controller, snap } = build();
    controller.tick(10);
    controller.preempt(E);
    expect(snap()).toMatchObject({ NORTH: YELLOW, SOUTH: YELLOW });
    controller.tick(5 + 2);
    expect(snap()).toEqual({ NORTH: RED, SOUTH: RED, EAST: GREEN, WEST: RED });
    controller.tick(300);
    expect(snap()[E]).toBe(GREEN);

    controller.clearPreemption();
    expect(snap()[E]).toBe(YELLOW);
    controller.tick(5 + 2);
    expect(controller.currentGreen).toEqual([N, S]);
  });

  it('holds an existing green for the emergency direction', () => {
    const { controller, snap } = build();
    controller.preempt(S);
    controller.tick(120);
    expect(snap()).toMatchObject({ NORTH: GREEN, SOUTH: GREEN });
  });

  it('allows one preemption at a time', () => {
    const { controller } = build();
    expect(() => controller.clearPreemption()).toThrow(NoPreemptionActiveError);
    controller.preempt(E);
    expect(() => controller.preempt(W)).toThrow(PreemptionActiveError);
  });
});

describe('Observers', () => {
  it('display boards and pedestrian signals follow every change', () => {
    const { controller } = build();
    const board = new DisplayBoard();
    const crossEastWest = new PedestrianSignal('across 5th', [E, W]);
    const crossNorthSouth = new PedestrianSignal('across Main', [N, S]);
    controller.subscribe(board);
    controller.subscribe(crossEastWest);
    const unsubscribe = controller.subscribe(crossNorthSouth);

    controller.tick(35); // N, S go yellow then red
    expect(board.log).toEqual([
      '08:00:30 NORTH GREEN -> YELLOW',
      '08:00:30 SOUTH GREEN -> YELLOW',
      '08:00:35 NORTH YELLOW -> RED',
      '08:00:35 SOUTH YELLOW -> RED',
    ]);
    expect(crossNorthSouth.state).toBe(PedestrianState.WALK);
    unsubscribe();
    controller.tick(2); // E, W green
    expect(crossEastWest.state).toBe(PedestrianState.DONT_WALK);
    expect(crossNorthSouth.state).toBe(PedestrianState.WALK);
    expect(board.log).toHaveLength(6);
  });
});
