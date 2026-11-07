import { King } from './king';
import { Knight } from './knight';
import { Pawn } from './pawn';
import { Color, type Piece, PieceType } from './piece';
import { Bishop, Queen, Rook } from './sliding-pieces';

const CONSTRUCTORS: Record<PieceType, new (color: Color) => Piece> = {
  [PieceType.PAWN]: Pawn,
  [PieceType.KNIGHT]: Knight,
  [PieceType.BISHOP]: Bishop,
  [PieceType.ROOK]: Rook,
  [PieceType.QUEEN]: Queen,
  [PieceType.KING]: King,
};

const TYPE_BY_LETTER = new Map<string, PieceType>([
  ['p', PieceType.PAWN],
  ['n', PieceType.KNIGHT],
  ['b', PieceType.BISHOP],
  ['r', PieceType.ROOK],
  ['q', PieceType.QUEEN],
  ['k', PieceType.KING],
]);

/** Factory: the single place that maps a type to a class. Board setup and promotion both use it. */
export function createPiece(type: PieceType, color: Color): Piece {
  return new CONSTRUCTORS[type](color);
}

/** FEN letter to piece: uppercase is white ("Q"), lowercase is black ("q"). */
export function pieceFromLetter(letter: string): Piece {
  const type = TYPE_BY_LETTER.get(letter.toLowerCase());
  if (!type) throw new RangeError(`Unknown piece letter "${letter}"`);
  return createPiece(type, letter === letter.toUpperCase() ? Color.WHITE : Color.BLACK);
}
