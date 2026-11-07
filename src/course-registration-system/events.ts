export enum RegistrationEventType {
  ENROLLED = 'ENROLLED',
  WAITLISTED = 'WAITLISTED',
  PROMOTED = 'PROMOTED',
  DROPPED = 'DROPPED',
}

export interface RegistrationEvent {
  readonly type: RegistrationEventType;
  readonly studentId: string;
  readonly sectionId: string;
  readonly at: Date;
}

/** Observer: the registrar announces changes; email, timetable sync and advisors subscribe. */
export interface RegistrationObserver {
  onRegistrationEvent(event: RegistrationEvent): void;
}

export class EventLog implements RegistrationObserver {
  readonly events: RegistrationEvent[] = [];

  onRegistrationEvent(event: RegistrationEvent): void {
    this.events.push(event);
  }

  forStudent(studentId: string): RegistrationEventType[] {
    return this.events.filter((e) => e.studentId === studentId).map((e) => e.type);
  }
}
