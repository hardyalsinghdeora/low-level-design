import { DomainError } from '../shared/errors';

export class HotelError extends DomainError {}

export class InvalidDateRangeError extends HotelError {}

export class RoomTypeNotFoundError extends HotelError {
  constructor(roomTypeId: string) {
    super(`No room type ${roomTypeId}`);
  }
}

export class RoomNotFoundError extends HotelError {
  constructor(roomNumber: string) {
    super(`No room ${roomNumber}`);
  }
}

export class GuestNotFoundError extends HotelError {
  constructor(guestId: string) {
    super(`No guest ${guestId}`);
  }
}

export class ReservationNotFoundError extends HotelError {
  constructor(reservationId: string) {
    super(`No reservation ${reservationId}`);
  }
}

export class RoomUnavailableError extends HotelError {
  constructor(roomNumber: string, checkIn: string, checkOut: string) {
    super(`Room ${roomNumber} is already booked between ${checkIn} and ${checkOut}`);
  }
}

export class NoRoomAvailableError extends HotelError {
  constructor(roomTypeId: string, checkIn: string, checkOut: string) {
    super(`No ${roomTypeId} room is free from ${checkIn} to ${checkOut}`);
  }
}

export class InvalidReservationTransitionError extends HotelError {
  constructor(reservationId: string, from: string, to: string) {
    super(`Reservation ${reservationId} cannot move from ${from} to ${to}`);
  }
}

export class CheckInNotAllowedError extends HotelError {
  constructor(reservationId: string, today: string, checkIn: string, checkOut: string) {
    super(`Reservation ${reservationId} can check in only from ${checkIn} until before ${checkOut} (today is ${today})`);
  }
}

export class ReservationNotActiveError extends HotelError {
  constructor(reservationId: string, status: string) {
    super(`Reservation ${reservationId} is ${status}; extras can be added only while CHECKED_IN`);
  }
}
