import {
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  Plus,
  RotateCcw,
  Shuffle,
  Star,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Page = "home" | "play";

type Player = {
  id: string;
  name: string;
};

type RowColor = "red" | "yellow" | "green" | "blue";

type RowState = {
  selected: number[];
  lock: "none" | "own" | "opponent";
};

type RowsState = Record<RowColor, RowState>;

type ScoreMark = {
  row: RowColor;
  number: number;
};

type DiceRoll = {
  whiteA: number;
  whiteB: number;
  red?: number;
  yellow?: number;
  green?: number;
  blue?: number;
};

type TurnCore = {
  roll: DiceRoll | null;
  opponentWhiteSum: number | null;
  selectedMarks: ScoreMark[];
  penalty: boolean;
  opponentLocks: RowColor[];
};

type UndoKind = "roll" | "whiteSum" | "mark" | "penalty" | "opponentLock";
type MarkRole = "white" | "mixed";

type UndoEntry = {
  before: TurnCore;
  kind: UndoKind;
};

type TurnDraft = TurnCore & {
  history: UndoEntry[];
};

type ActiveGame = {
  page: "play";
  players: Player[];
  selectedPlayerId: string;
  currentPlayerIndex: number;
  rows: RowsState;
  penalties: number;
  turn: TurnDraft;
  gameOver: boolean;
  gameOverReason: "rows" | "ownPenalties" | "opponentPenalties" | null;
};

type RowConfig = {
  color: RowColor;
  label: string;
  numbers: number[];
  finalNumber: number;
};

const PLAYERS_KEY = "qwixx.players.v1";
const SELECTED_PLAYER_KEY = "qwixx.selectedPlayer.v1";
const SHOW_HINTS_KEY = "qwixx.showHints.v1";
const ACTIVE_GAME_KEY = "qwixx.activeGame.v1";

const ROW_COLORS = ["red", "yellow", "green", "blue"] as const;
const SUM_NUMBERS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const SCORE_VALUES = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78] as const;
const MAX_PENALTIES = 4;
const PENALTY_POINTS = 5;

const ROW_CONFIGS: Record<RowColor, RowConfig> = {
  red: {
    color: "red",
    label: "Red",
    numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    finalNumber: 12,
  },
  yellow: {
    color: "yellow",
    label: "Yellow",
    numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    finalNumber: 12,
  },
  green: {
    color: "green",
    label: "Green",
    numbers: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
    finalNumber: 2,
  },
  blue: {
    color: "blue",
    label: "Blue",
    numbers: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
    finalNumber: 2,
  },
};

const DICE_LAYOUT = [
  { key: "whiteA", color: "white", row: 1, column: 1 },
  { key: "red", color: "red", row: 1, column: 2 },
  { key: "green", color: "green", row: 1, column: 3 },
  { key: "whiteB", color: "white", row: 2, column: 1 },
  { key: "yellow", color: "yellow", row: 2, column: 2 },
  { key: "blue", color: "blue", row: 2, column: 3 },
] as const;

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEmptyRows(): RowsState {
  return {
    red: { selected: [], lock: "none" },
    yellow: { selected: [], lock: "none" },
    green: { selected: [], lock: "none" },
    blue: { selected: [], lock: "none" },
  };
}

function createEmptyTurn(): TurnDraft {
  return {
    roll: null,
    opponentWhiteSum: null,
    selectedMarks: [],
    penalty: false,
    opponentLocks: [],
    history: [],
  };
}

function createFreshGame(players: Player[], selectedPlayerId: string): ActiveGame {
  return {
    page: "play",
    players,
    selectedPlayerId,
    currentPlayerIndex: 0,
    rows: createEmptyRows(),
    penalties: 0,
    turn: createEmptyTurn(),
    gameOver: false,
    gameOverReason: null,
  };
}

function isRowColor(value: unknown): value is RowColor {
  return typeof value === "string" && (ROW_COLORS as readonly string[]).includes(value);
}

function isValidSum(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= 12;
}

function uniqueRows(rows: RowColor[]) {
  return rows.filter((row, index) => rows.indexOf(row) === index);
}

function toTurnCore(turn: TurnDraft): TurnCore {
  return {
    roll: turn.roll,
    opponentWhiteSum: turn.opponentWhiteSum,
    selectedMarks: turn.selectedMarks,
    penalty: turn.penalty,
    opponentLocks: turn.opponentLocks,
  };
}

function withUndoHistory(currentTurn: TurnDraft, nextTurn: TurnCore, kind: UndoKind): TurnDraft {
  return {
    ...nextTurn,
    history: [...currentTurn.history, { before: toTurnCore(currentTurn), kind }],
  };
}

function restoreUndoEntry(turn: TurnDraft, entry: UndoEntry): TurnDraft {
  return {
    ...entry.before,
    history: turn.history.slice(0, -1),
  };
}

function normalizePlayers(value: unknown): Player[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((player) => {
      if (!player || typeof player !== "object") {
        return null;
      }

      const candidate = player as Partial<Player>;
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";

      if (!name) {
        return null;
      }

      return {
        id: typeof candidate.id === "string" ? candidate.id : createId(),
        name,
      };
    })
    .filter((player): player is Player => Boolean(player));
}

function normalizeRows(value: unknown): RowsState {
  const rows = createEmptyRows();

  if (!value || typeof value !== "object") {
    return rows;
  }

  const rawRows = value as Partial<Record<RowColor, Partial<RowState>>>;

  ROW_COLORS.forEach((row) => {
    const rawRow = rawRows[row];
    const selected = Array.isArray(rawRow?.selected)
      ? rawRow.selected
          .filter((number): number is number => ROW_CONFIGS[row].numbers.includes(Number(number)))
          .map(Number)
          .filter((number, index, values) => values.indexOf(number) === index)
          .sort((left, right) => visualIndex(row, left) - visualIndex(row, right))
      : [];
    const lock = rawRow?.lock === "own" || rawRow?.lock === "opponent" ? rawRow.lock : "none";

    rows[row] = { selected, lock };
  });

  return rows;
}

function normalizeRoll(value: unknown): DiceRoll | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rawRoll = value as Partial<Record<keyof DiceRoll, unknown>>;
  const whiteA = Number(rawRoll.whiteA);
  const whiteB = Number(rawRoll.whiteB);

  if (!isDieValue(whiteA) || !isDieValue(whiteB)) {
    return null;
  }

  const roll: DiceRoll = { whiteA, whiteB };

  ROW_COLORS.forEach((row) => {
    const valueForRow = Number(rawRoll[row]);
    if (isDieValue(valueForRow)) {
      roll[row] = valueForRow;
    }
  });

  return roll;
}

function normalizeTurnCore(value: unknown): TurnCore {
  const turn: TurnCore = {
    roll: null,
    opponentWhiteSum: null,
    selectedMarks: [],
    penalty: false,
    opponentLocks: [],
  };
  if (!value || typeof value !== "object") {
    return turn;
  }

  const rawTurn = value as Partial<TurnCore>;
  const opponentWhiteSum = Number(rawTurn.opponentWhiteSum);

  turn.roll = normalizeRoll(rawTurn.roll);
  turn.opponentWhiteSum = isValidSum(opponentWhiteSum) ? opponentWhiteSum : null;
  turn.penalty = rawTurn.penalty === true;
  turn.opponentLocks = Array.isArray(rawTurn.opponentLocks)
    ? uniqueRows(rawTurn.opponentLocks.filter(isRowColor))
    : [];
  turn.selectedMarks = Array.isArray(rawTurn.selectedMarks)
    ? rawTurn.selectedMarks
        .map((mark) => {
          if (!mark || typeof mark !== "object") {
            return null;
          }

          const candidate = mark as Partial<ScoreMark>;
          const row = candidate.row;
          const number = Number(candidate.number);

          if (!isRowColor(row) || !ROW_CONFIGS[row].numbers.includes(number)) {
            return null;
          }

          return { row, number };
        })
        .filter((mark): mark is ScoreMark => Boolean(mark))
        .filter((mark, index, marks) => marks.findIndex((other) => markKey(other) === markKey(mark)) === index)
        .slice(0, 2)
    : [];

  return turn;
}

function normalizeUndoEntry(value: unknown): UndoEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rawEntry = value as Partial<UndoEntry>;
  const kind = rawEntry.kind;

  if (
    kind !== "roll" &&
    kind !== "whiteSum" &&
    kind !== "mark" &&
    kind !== "penalty" &&
    kind !== "opponentLock"
  ) {
    return null;
  }

  return {
    before: normalizeTurnCore(rawEntry.before),
    kind,
  };
}

function normalizeTurn(value: unknown): TurnDraft {
  const core = normalizeTurnCore(value);
  const rawTurn = value && typeof value === "object" ? (value as Partial<TurnDraft>) : null;
  const history = Array.isArray(rawTurn?.history)
    ? rawTurn.history.map(normalizeUndoEntry).filter((entry): entry is UndoEntry => Boolean(entry))
    : [];

  return {
    ...core,
    history,
  };
}

function readStoredPlayers(): Player[] {
  try {
    return normalizePlayers(JSON.parse(localStorage.getItem(PLAYERS_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function readSelectedPlayerId() {
  try {
    const value = localStorage.getItem(SELECTED_PLAYER_KEY);
    return value || null;
  } catch {
    return null;
  }
}

function readStoredShowHints() {
  try {
    return localStorage.getItem(SHOW_HINTS_KEY) === "true";
  } catch {
    return false;
  }
}

function readActiveGame(): ActiveGame | null {
  try {
    const raw = localStorage.getItem(ACTIVE_GAME_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const game = parsed as Partial<ActiveGame>;
    const players = normalizePlayers(game.players);
    const selectedPlayerId = typeof game.selectedPlayerId === "string" ? game.selectedPlayerId : "";
    const currentPlayerIndex = Number(game.currentPlayerIndex);
    const penalties = Number(game.penalties);
    const gameOverReason =
      game.gameOverReason === "rows" ||
      game.gameOverReason === "ownPenalties" ||
      game.gameOverReason === "opponentPenalties"
        ? game.gameOverReason
        : null;

    if (
      game.page !== "play" ||
      players.length === 0 ||
      !players.some((player) => player.id === selectedPlayerId) ||
      !Number.isInteger(currentPlayerIndex) ||
      currentPlayerIndex < 0 ||
      currentPlayerIndex >= players.length
    ) {
      return null;
    }

    return {
      page: "play",
      players,
      selectedPlayerId,
      currentPlayerIndex,
      rows: normalizeRows(game.rows),
      penalties: Number.isInteger(penalties) ? Math.max(0, Math.min(MAX_PENALTIES, penalties)) : 0,
      turn: normalizeTurn(game.turn),
      gameOver: game.gameOver === true,
      gameOverReason,
    };
  } catch {
    return null;
  }
}

function shufflePlayers(players: Player[]) {
  const shuffled = [...players];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, item);
  return nextItems;
}

function isDieValue(value: number): value is 1 | 2 | 3 | 4 | 5 | 6 {
  return Number.isInteger(value) && value >= 1 && value <= 6;
}

function rollDie() {
  return (Math.floor(Math.random() * 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
}

function rollDice(rows: RowsState): DiceRoll {
  const roll: DiceRoll = {
    whiteA: rollDie(),
    whiteB: rollDie(),
  };

  ROW_COLORS.forEach((row) => {
    if (rows[row].lock === "none") {
      roll[row] = rollDie();
    }
  });

  return roll;
}

function markKey(mark: ScoreMark) {
  return `${mark.row}-${mark.number}`;
}

function visualIndex(row: RowColor, number: number) {
  return ROW_CONFIGS[row].numbers.indexOf(number);
}

function getCommittedClosedCount(rows: RowsState) {
  return ROW_COLORS.filter((row) => rows[row].lock !== "none").length;
}

function getSelectedCountForRow(row: RowColor, rows: RowsState, turn: TurnDraft) {
  const stagedCount = turn.selectedMarks.filter((mark) => mark.row === row).length;
  return rows[row].selected.length + stagedCount;
}

function getRightmostSelectedIndex(row: RowColor, rows: RowsState, turn: TurnDraft) {
  const indexes = [
    ...rows[row].selected.map((number) => visualIndex(row, number)),
    ...turn.selectedMarks.filter((mark) => mark.row === row).map((mark) => visualIndex(row, mark.number)),
  ];

  return indexes.length > 0 ? Math.max(...indexes) : -1;
}

function hasStagedOwnLock(row: RowColor, turn: TurnDraft) {
  return turn.selectedMarks.some((mark) => mark.row === row && mark.number === ROW_CONFIGS[row].finalNumber);
}

function isRowUnavailableThisTurn(row: RowColor, rows: RowsState, turn: TurnDraft) {
  return rows[row].lock !== "none" || turn.opponentLocks.includes(row) || hasStagedOwnLock(row, turn);
}

function canPhysicallySelectMark(row: RowColor, number: number, rows: RowsState, turn: TurnDraft) {
  if (isRowUnavailableThisTurn(row, rows, turn)) {
    return false;
  }

  if (turn.selectedMarks.some((mark) => mark.row === row && mark.number === number)) {
    return false;
  }

  if (!ROW_CONFIGS[row].numbers.includes(number)) {
    return false;
  }

  const index = visualIndex(row, number);

  if (index <= getRightmostSelectedIndex(row, rows, turn)) {
    return false;
  }

  if (number === ROW_CONFIGS[row].finalNumber && getSelectedCountForRow(row, rows, turn) < 5) {
    return false;
  }

  return true;
}

function getWhiteSum(turn: TurnDraft, isUserTurn: boolean) {
  if (isUserTurn) {
    return turn.roll ? turn.roll.whiteA + turn.roll.whiteB : null;
  }

  return turn.opponentWhiteSum;
}

function getMixedSums(turn: TurnDraft) {
  const sums: Partial<Record<RowColor, number[]>> = {};

  const roll = turn.roll;

  if (!roll) {
    return sums;
  }

  ROW_COLORS.forEach((row) => {
    const dieValue = roll[row];

    if (dieValue) {
      sums[row] = [roll.whiteA + dieValue, roll.whiteB + dieValue];
    }
  });

  return sums;
}

function getRolesForMark(mark: ScoreMark, whiteSum: number | null, mixedSums: Partial<Record<RowColor, number[]>>) {
  const roles: MarkRole[] = [];

  if (whiteSum === mark.number) {
    roles.push("white");
  }

  if (mixedSums[mark.row]?.includes(mark.number)) {
    roles.push("mixed");
  }

  return roles;
}

function hasValidUserInterpretation(marks: ScoreMark[], turn: TurnDraft) {
  const whiteSum = getWhiteSum(turn, true);
  const mixedSums = getMixedSums(turn);

  if (!whiteSum || marks.length === 0 || marks.length > 2) {
    return false;
  }

  if (marks.length === 1) {
    return getRolesForMark(marks[0], whiteSum, mixedSums).length > 0;
  }

  const firstRoles = getRolesForMark(marks[0], whiteSum, mixedSums);
  const secondRoles = getRolesForMark(marks[1], whiteSum, mixedSums);

  return firstRoles.includes("white") && secondRoles.includes("mixed");
}

function getCandidateMarks(rows: RowsState, turn: TurnDraft) {
  return ROW_COLORS.flatMap((row) =>
    ROW_CONFIGS[row].numbers
      .filter((number) => canPhysicallySelectMark(row, number, rows, turn))
      .map((number) => ({ row, number })),
  );
}

function getLegalMarkKeys({
  rows,
  turn,
  isUserTurn,
  gameOver,
}: {
  rows: RowsState;
  turn: TurnDraft;
  isUserTurn: boolean;
  gameOver: boolean;
}) {
  if (gameOver) {
    return new Set<string>();
  }

  const whiteSum = getWhiteSum(turn, isUserTurn);

  if (!whiteSum) {
    return new Set<string>();
  }

  if (!isUserTurn) {
    if (turn.selectedMarks.length > 0 || turn.penalty) {
      return new Set<string>();
    }

    return new Set(
      getCandidateMarks(rows, turn)
        .filter((mark) => mark.number === whiteSum)
        .map(markKey),
    );
  }

  if (turn.penalty || turn.selectedMarks.length >= 2) {
    return new Set<string>();
  }

  return new Set(
    getCandidateMarks(rows, turn)
      .filter((mark) => hasValidUserInterpretation([...turn.selectedMarks, mark], turn))
      .map(markKey),
  );
}

function getLegalMarkRoles({
  rows,
  turn,
  isUserTurn,
  gameOver,
}: {
  rows: RowsState;
  turn: TurnDraft;
  isUserTurn: boolean;
  gameOver: boolean;
}) {
  const roleMap = new Map<string, Set<MarkRole>>();

  if (gameOver) {
    return roleMap;
  }

  const whiteSum = getWhiteSum(turn, isUserTurn);

  if (!whiteSum) {
    return roleMap;
  }

  if (!isUserTurn) {
    if (turn.selectedMarks.length > 0 || turn.penalty) {
      return roleMap;
    }

    getCandidateMarks(rows, turn)
      .filter((mark) => mark.number === whiteSum)
      .forEach((mark) => roleMap.set(markKey(mark), new Set(["white"])));
    return roleMap;
  }

  if (turn.penalty || turn.selectedMarks.length >= 2) {
    return roleMap;
  }

  const mixedSums = getMixedSums(turn);

  getCandidateMarks(rows, turn).forEach((mark) => {
    const roles = getRolesForMark(mark, whiteSum, mixedSums);
    const legalRoles = new Set<MarkRole>();

    if (turn.selectedMarks.length === 0) {
      roles.forEach((role) => {
        if (hasValidUserInterpretation([mark], turn)) {
          legalRoles.add(role);
        }
      });
    } else if (roles.includes("mixed") && hasValidUserInterpretation([...turn.selectedMarks, mark], turn)) {
      legalRoles.add("mixed");
    }

    if (legalRoles.size > 0) {
      roleMap.set(markKey(mark), legalRoles);
    }
  });

  return roleMap;
}

function canSelectPenalty(turn: TurnDraft, isUserTurn: boolean, penalties: number, gameOver: boolean) {
  return (
    isUserTurn &&
    !gameOver &&
    Boolean(turn.roll) &&
    !turn.penalty &&
    turn.selectedMarks.length === 0 &&
    penalties < MAX_PENALTIES
  );
}

function canStageOpponentLock(row: RowColor, rows: RowsState, turn: TurnDraft, diceStageDone: boolean, gameOver: boolean) {
  return (
    !gameOver &&
    diceStageDone &&
    rows[row].lock === "none" &&
    !turn.opponentLocks.includes(row) &&
    !hasStagedOwnLock(row, turn)
  );
}

function canAdvanceTurn(turn: TurnDraft, isUserTurn: boolean, gameOver: boolean) {
  if (gameOver) {
    return false;
  }

  if (isUserTurn) {
    if (!turn.roll) {
      return false;
    }

    if (turn.penalty) {
      return turn.selectedMarks.length === 0;
    }

    return hasValidUserInterpretation(turn.selectedMarks, turn);
  }

  return turn.opponentWhiteSum !== null;
}

function getPreviewColorCount(row: RowColor, rows: RowsState, turn: TurnDraft) {
  const committed = rows[row].selected.length + (rows[row].lock === "own" ? 1 : 0);
  const stagedMarks = turn.selectedMarks.filter((mark) => mark.row === row).length;
  const stagedLock = hasStagedOwnLock(row, turn) ? 1 : 0;
  return committed + stagedMarks + stagedLock;
}

function getColorScore(row: RowColor, rows: RowsState, turn: TurnDraft) {
  return SCORE_VALUES[Math.min(12, getPreviewColorCount(row, rows, turn))];
}

function getPenaltyCount(penalties: number, turn: TurnDraft) {
  return penalties + (turn.penalty ? 1 : 0);
}

function getTotalScore(rows: RowsState, penalties: number, turn: TurnDraft) {
  const colorTotal = ROW_COLORS.reduce((total, row) => total + getColorScore(row, rows, turn), 0);
  return colorTotal - getPenaltyCount(penalties, turn) * PENALTY_POINTS;
}

function App() {
  const savedGameRef = useRef<ActiveGame | null>(readActiveGame());
  const savedGame = savedGameRef.current;
  const [page, setPage] = useState<Page>(savedGame?.page ?? "home");
  const [players, setPlayers] = useState<Player[]>(savedGame?.players ?? readStoredPlayers);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(
    savedGame?.selectedPlayerId ?? readSelectedPlayerId(),
  );
  const [draftName, setDraftName] = useState("");
  const [gamePlayers, setGamePlayers] = useState<Player[]>(savedGame?.players ?? []);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(savedGame?.currentPlayerIndex ?? 0);
  const [rows, setRows] = useState<RowsState>(savedGame?.rows ?? createEmptyRows);
  const [penalties, setPenalties] = useState(savedGame?.penalties ?? 0);
  const [turn, setTurn] = useState<TurnDraft>(savedGame?.turn ?? createEmptyTurn);
  const [gameOver, setGameOver] = useState(savedGame?.gameOver ?? false);
  const [gameOverReason, setGameOverReason] = useState<ActiveGame["gameOverReason"]>(
    savedGame?.gameOverReason ?? null,
  );
  const [showHints, setShowHints] = useState(readStoredShowHints);
  const [confirmAction, setConfirmAction] = useState<"rollUndo" | "exit" | "startOver" | null>(null);
  const [draggingPlayerId, setDraggingPlayerId] = useState<string | null>(null);
  const [rollAnimationKey, setRollAnimationKey] = useState(0);
  const draftNameInputRef = useRef<HTMLInputElement>(null);

  const selectedPlayerExists = selectedPlayerId ? players.some((player) => player.id === selectedPlayerId) : false;
  const currentPlayer = gamePlayers[currentPlayerIndex] ?? null;
  const isUserTurn = Boolean(currentPlayer && currentPlayer.id === selectedPlayerId);
  const whiteSum = getWhiteSum(turn, isUserTurn);
  const diceStageDone = Boolean(whiteSum);
  const legalMarkKeys = useMemo(
    () => getLegalMarkKeys({ rows, turn, isUserTurn, gameOver }),
    [rows, turn, isUserTurn, gameOver],
  );
  const legalMarkRoles = useMemo(
    () => getLegalMarkRoles({ rows, turn, isUserTurn, gameOver }),
    [rows, turn, isUserTurn, gameOver],
  );
  const nextEnabled = canAdvanceTurn(turn, isUserTurn, gameOver);
  const penaltyEnabled = canSelectPenalty(turn, isUserTurn, penalties, gameOver);
  const totalScore = getTotalScore(rows, penalties, turn);
  const penaltyCount = getPenaltyCount(penalties, turn);
  const canStart =
    players.length > 0 &&
    players.every((player) => player.name.trim().length > 0) &&
    Boolean(selectedPlayerId && selectedPlayerExists);
  const canUndo = turn.history.length > 0 && !gameOver;

  useEffect(() => {
    localStorage.setItem(PLAYERS_KEY, JSON.stringify(players));
  }, [players]);

  useEffect(() => {
    if (selectedPlayerId) {
      localStorage.setItem(SELECTED_PLAYER_KEY, selectedPlayerId);
    } else {
      localStorage.removeItem(SELECTED_PLAYER_KEY);
    }
  }, [selectedPlayerId]);

  useEffect(() => {
    localStorage.setItem(SHOW_HINTS_KEY, showHints ? "true" : "false");
  }, [showHints]);

  useEffect(() => {
    if (selectedPlayerId && !players.some((player) => player.id === selectedPlayerId)) {
      setSelectedPlayerId(null);
    }
  }, [players, selectedPlayerId]);

  useEffect(() => {
    if (page !== "play" || gamePlayers.length === 0 || !selectedPlayerId) {
      return;
    }

    const activeGame: ActiveGame = {
      page: "play",
      players: gamePlayers,
      selectedPlayerId,
      currentPlayerIndex,
      rows,
      penalties,
      turn,
      gameOver,
      gameOverReason,
    };

    localStorage.setItem(ACTIVE_GAME_KEY, JSON.stringify(activeGame));
  }, [
    page,
    gamePlayers,
    selectedPlayerId,
    currentPlayerIndex,
    rows,
    penalties,
    turn,
    gameOver,
    gameOverReason,
  ]);

  useEffect(() => {
    if (!draggingPlayerId) {
      return undefined;
    }

    const activeDraggingPlayerId = draggingPlayerId;

    function handlePointerMove(event: PointerEvent) {
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-player-id]");
      const overPlayerId = row?.dataset.playerId;

      if (overPlayerId && overPlayerId !== activeDraggingPlayerId) {
        reorderPlayer(activeDraggingPlayerId, overPlayerId);
      }
    }

    function handlePointerUp() {
      setDraggingPlayerId(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [draggingPlayerId, players]);

  function addPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = draftName.trim();
    if (!name) {
      return;
    }

    const player = { id: createId(), name };

    setPlayers((currentPlayers) => [...currentPlayers, player]);
    setSelectedPlayerId((currentSelectedId) => currentSelectedId ?? player.id);
    setDraftName("");
    draftNameInputRef.current?.focus();
  }

  function updatePlayer(playerId: string, updates: Partial<Player>) {
    setPlayers((currentPlayers) =>
      currentPlayers.map((player) => (player.id === playerId ? { ...player, ...updates } : player)),
    );
  }

  function removePlayer(playerId: string) {
    setPlayers((currentPlayers) => currentPlayers.filter((player) => player.id !== playerId));
    setSelectedPlayerId((currentSelectedId) => (currentSelectedId === playerId ? null : currentSelectedId));
  }

  function reorderPlayer(playerId: string, overPlayerId: string) {
    setPlayers((currentPlayers) => {
      const fromIndex = currentPlayers.findIndex((player) => player.id === playerId);
      const toIndex = currentPlayers.findIndex((player) => player.id === overPlayerId);

      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return currentPlayers;
      }

      return moveItem(currentPlayers, fromIndex, toIndex);
    });
  }

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, playerId: string) {
    event.preventDefault();
    setDraggingPlayerId(playerId);
  }

  function startGame(nextPlayers: Player[], nextSelectedPlayerId: string) {
    const orderedPlayers = nextPlayers
      .map((player) => ({ ...player, name: player.name.trim() }))
      .filter((player) => player.name.length > 0);

    if (orderedPlayers.length === 0 || !orderedPlayers.some((player) => player.id === nextSelectedPlayerId)) {
      return;
    }

    const game = createFreshGame(orderedPlayers, nextSelectedPlayerId);

    localStorage.removeItem(ACTIVE_GAME_KEY);
    setPlayers(orderedPlayers);
    setSelectedPlayerId(nextSelectedPlayerId);
    setGamePlayers(game.players);
    setCurrentPlayerIndex(game.currentPlayerIndex);
    setRows(game.rows);
    setPenalties(game.penalties);
    setTurn(game.turn);
    setGameOver(game.gameOver);
    setGameOverReason(game.gameOverReason);
    setPage("play");
    setRollAnimationKey(0);
  }

  function startOver() {
    if (!selectedPlayerId || gamePlayers.length === 0) {
      return;
    }

    setConfirmAction("startOver");
  }

  function confirmStartOver() {
    if (!selectedPlayerId || gamePlayers.length === 0) {
      return;
    }

    setConfirmAction(null);
    startGame(gamePlayers, selectedPlayerId);
  }

  function exitToHome() {
    setConfirmAction("exit");
  }

  function confirmExitToHome() {
    localStorage.removeItem(ACTIVE_GAME_KEY);
    setConfirmAction(null);
    setPage("home");
    setGamePlayers([]);
    setCurrentPlayerIndex(0);
    setRows(createEmptyRows());
    setPenalties(0);
    setTurn(createEmptyTurn());
    setGameOver(false);
    setGameOverReason(null);
    setRollAnimationKey(0);
  }

  function handleRollDice() {
    if (!isUserTurn || gameOver || turn.roll) {
      return;
    }

    setTurn((currentTurn) => {
      if (currentTurn.roll) {
        return currentTurn;
      }

      return withUndoHistory(currentTurn, {
        roll: rollDice(rows),
        opponentWhiteSum: null,
        selectedMarks: [],
        penalty: false,
        opponentLocks: [],
      }, "roll");
    });
    setRollAnimationKey((key) => key + 1);
  }

  function selectOpponentWhiteSum(sum: number) {
    if (isUserTurn || gameOver || turn.opponentWhiteSum !== null || !SUM_NUMBERS.includes(sum as 2)) {
      return;
    }

    setTurn((currentTurn) => {
      if (currentTurn.opponentWhiteSum !== null) {
        return currentTurn;
      }

      return withUndoHistory(currentTurn, {
        roll: null,
        opponentWhiteSum: sum,
        selectedMarks: [],
        penalty: false,
        opponentLocks: [],
      }, "whiteSum");
    });
  }

  function selectMark(mark: ScoreMark) {
    if (!legalMarkKeys.has(markKey(mark))) {
      return;
    }

    setTurn((currentTurn) => {
      const currentLegalMarks = getLegalMarkKeys({ rows, turn: currentTurn, isUserTurn, gameOver });

      if (!currentLegalMarks.has(markKey(mark))) {
        return currentTurn;
      }

      return withUndoHistory(currentTurn, {
        roll: currentTurn.roll,
        opponentWhiteSum: currentTurn.opponentWhiteSum,
        selectedMarks: [...currentTurn.selectedMarks, mark],
        penalty: currentTurn.penalty,
        opponentLocks: currentTurn.opponentLocks,
      }, "mark");
    });
  }

  function selectPenalty() {
    if (!penaltyEnabled) {
      return;
    }

    setTurn((currentTurn) => {
      if (!canSelectPenalty(currentTurn, isUserTurn, penalties, gameOver)) {
        return currentTurn;
      }

      return withUndoHistory(currentTurn, {
        roll: currentTurn.roll,
        opponentWhiteSum: currentTurn.opponentWhiteSum,
        penalty: true,
        selectedMarks: [],
        opponentLocks: currentTurn.opponentLocks,
      }, "penalty");
    });
  }

  function stageOpponentLock(row: RowColor) {
    if (!canStageOpponentLock(row, rows, turn, diceStageDone, gameOver)) {
      return;
    }

    setTurn((currentTurn) => {
      if (!canStageOpponentLock(row, rows, currentTurn, Boolean(getWhiteSum(currentTurn, isUserTurn)), gameOver)) {
        return currentTurn;
      }

      return withUndoHistory(currentTurn, {
        roll: currentTurn.roll,
        opponentWhiteSum: currentTurn.opponentWhiteSum,
        selectedMarks: currentTurn.selectedMarks,
        penalty: currentTurn.penalty,
        opponentLocks: uniqueRows([...currentTurn.opponentLocks, row]),
      }, "opponentLock");
    });
  }

  function undoTurn() {
    if (!canUndo) {
      return;
    }

    const latestEntry = turn.history.at(-1);

    if (latestEntry?.kind === "roll") {
      setConfirmAction("rollUndo");
      return;
    }

    performUndo();
  }

  function performUndo() {
    setTurn((currentTurn) => {
      const latestEntry = currentTurn.history.at(-1);
      return latestEntry ? restoreUndoEntry(currentTurn, latestEntry) : currentTurn;
    });
    setConfirmAction(null);
  }

  function cancelConfirmAction() {
    setConfirmAction(null);
  }

  function confirmPendingAction() {
    if (confirmAction === "rollUndo") {
      performUndo();
      return;
    }

    if (confirmAction === "exit") {
      confirmExitToHome();
      return;
    }

    if (confirmAction === "startOver") {
      confirmStartOver();
    }
  }

  function endByOpponentPenalties() {
    if (gameOver) {
      return;
    }

    setGameOver(true);
    setGameOverReason("opponentPenalties");
  }

  function commitTurn() {
    if (!nextEnabled) {
      return;
    }

    const nextRows: RowsState = {
      red: { selected: [...rows.red.selected], lock: rows.red.lock },
      yellow: { selected: [...rows.yellow.selected], lock: rows.yellow.lock },
      green: { selected: [...rows.green.selected], lock: rows.green.lock },
      blue: { selected: [...rows.blue.selected], lock: rows.blue.lock },
    };

    turn.selectedMarks.forEach((mark) => {
      if (!nextRows[mark.row].selected.includes(mark.number)) {
        nextRows[mark.row].selected.push(mark.number);
        nextRows[mark.row].selected.sort((left, right) => visualIndex(mark.row, left) - visualIndex(mark.row, right));
      }
    });

    ROW_COLORS.forEach((row) => {
      if (hasStagedOwnLock(row, turn)) {
        nextRows[row].lock = "own";
      }
    });

    turn.opponentLocks.forEach((row) => {
      if (nextRows[row].lock === "none") {
        nextRows[row].lock = "opponent";
      }
    });

    const nextPenalties = penalties + (turn.penalty ? 1 : 0);
    const nextClosedCount = getCommittedClosedCount(nextRows);
    const nextGameOver =
      nextClosedCount >= 2 || nextPenalties >= MAX_PENALTIES || gameOverReason === "opponentPenalties";
    const nextGameOverReason =
      nextClosedCount >= 2 ? "rows" : nextPenalties >= MAX_PENALTIES ? "ownPenalties" : gameOverReason;

    setRows(nextRows);
    setPenalties(nextPenalties);

    if (nextGameOver) {
      setGameOver(true);
      setGameOverReason(nextGameOverReason);
      setTurn({
        ...createEmptyTurn(),
        roll: turn.roll,
        opponentWhiteSum: turn.opponentWhiteSum,
      });
      return;
    }

    setCurrentPlayerIndex((index) => (index + 1) % gamePlayers.length);
    setTurn(createEmptyTurn());
    setGameOver(false);
    setGameOverReason(null);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <img src="./icon.svg" alt="" className="brand-mark" />
          <strong>Qwixx</strong>
        </div>
      </header>

      {page === "home" ? (
        <div className="page-stack">
          <section className="section-panel">
            <div className="section-heading">
              <h1>Players</h1>
              <div className="heading-actions">
                <button className="secondary" type="button" onClick={() => setPlayers(shufflePlayers(players))}>
                  <Shuffle size={18} />
                  Randomize
                </button>
                <button
                  className="secondary danger-button"
                  type="button"
                  onClick={() => {
                    setPlayers([]);
                    setSelectedPlayerId(null);
                  }}
                  disabled={players.length === 0}
                >
                  <Trash2 size={18} />
                  Clear
                </button>
              </div>
            </div>

            <form className="add-player" onSubmit={addPlayer}>
              <input
                ref={draftNameInputRef}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Name"
                autoComplete="off"
              />
              <button className="primary" type="submit" disabled={!draftName.trim()}>
                <Plus size={18} />
                Add
              </button>
            </form>

            <div className="player-list">
              {players.map((player) => (
                <article
                  className={draggingPlayerId === player.id ? "player-row dragging" : "player-row"}
                  data-player-id={player.id}
                  key={player.id}
                >
                  <button
                    className="drag-handle"
                    type="button"
                    onPointerDown={(event) => beginDrag(event, player.id)}
                    aria-label={`Move ${player.name}`}
                  >
                    <GripVertical size={18} />
                  </button>
                  <input
                    value={player.name}
                    onChange={(event) => updatePlayer(player.id, { name: event.target.value })}
                    autoComplete="off"
                    aria-label={`${player.name || "Player"} name`}
                  />
                  <button
                    className={selectedPlayerId === player.id ? "icon-button star selected" : "icon-button star"}
                    type="button"
                    onClick={() => setSelectedPlayerId(player.id)}
                    aria-label={`${player.name || "Player"} is me`}
                  >
                    <Star size={17} fill={selectedPlayerId === player.id ? "currentColor" : "none"} />
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    onClick={() => removePlayer(player.id)}
                    aria-label={`Remove ${player.name || "player"}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="section-panel compact-panel">
            <div className="section-heading">
              <h1>Game</h1>
            </div>

            <button
              className="primary wide-button start-button"
              type="button"
              onClick={() => selectedPlayerId && startGame(players, selectedPlayerId)}
              disabled={!canStart}
            >
              Start
            </button>
          </section>
        </div>
      ) : null}

      {page === "play" && currentPlayer ? (
        <div className="page-stack">
          <section className="section-panel play-panel">
            <div className="top-actions">
              <button className="icon-action" type="button" onClick={exitToHome} aria-label="Exit">
                <X size={19} />
              </button>
              <div className="play-actions">
                <button className="icon-action" type="button" onClick={startOver} aria-label="Start over">
                  <RotateCcw size={19} />
                </button>
                <button
                  className={showHints ? "icon-action selected" : "icon-action"}
                  type="button"
                  onClick={() => setShowHints((currentShowHints) => !currentShowHints)}
                  aria-label={showHints ? "Hide legal options" : "Show legal options"}
                >
                  {showHints ? <Eye size={19} /> : <EyeOff size={19} />}
                </button>
              </div>
            </div>

            <div className="turn-title">
              <h1>{currentPlayer.name}</h1>
              {isUserTurn ? <Star size={18} fill="currentColor" aria-label="Your turn" /> : null}
            </div>

            <DiceGrid
              rows={rows}
              roll={turn.roll}
              rollAnimationKey={rollAnimationKey}
              enabled={isUserTurn && !gameOver && !turn.roll}
              pale={!isUserTurn}
              onRoll={handleRollDice}
            />

            <div
              className={!isUserTurn && !gameOver && turn.opponentWhiteSum === null ? "sum-strip needs-input" : "sum-strip"}
              aria-label="White dice sum"
            >
              {SUM_NUMBERS.map((sum) => {
                const selectable = !isUserTurn && !gameOver && turn.opponentWhiteSum === null;
                return (
                  <button
                    className={whiteSum === sum ? "sum-box selected" : "sum-box"}
                    type="button"
                    key={sum}
                    onClick={() => selectOpponentWhiteSum(sum)}
                    disabled={!selectable}
                    aria-label={`White sum ${sum}`}
                  >
                    {sum}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="turn-action-row">
            <button
              className="secondary turn-action-button"
              type="button"
              onClick={undoTurn}
              disabled={!canUndo}
              aria-label="Undo"
            >
              <Undo2 size={21} />
            </button>
            <button
              className="primary turn-action-button"
              type="button"
              onClick={commitTurn}
              disabled={!nextEnabled}
              aria-label="Next"
            >
              <ArrowRight size={23} />
            </button>
          </div>

          <section className="score-card" aria-label="Score card">
            <div className="score-rows">
              {ROW_COLORS.map((row) => (
                <ScoreRow
                  key={row}
                  row={row}
                  rows={rows}
                  turn={turn}
                  legalMarkKeys={legalMarkKeys}
                  legalMarkRoles={legalMarkRoles}
                  showHints={showHints}
                  canLock={canStageOpponentLock(row, rows, turn, diceStageDone, gameOver)}
                  gameOver={gameOver}
                  onSelectMark={selectMark}
                  onStageOpponentLock={stageOpponentLock}
                />
              ))}
            </div>

            <div className="penalty-row">
              <div className="penalty-left">
                <button
                  className={turn.penalty ? "penalty-button selected" : "penalty-button"}
                  type="button"
                  onClick={selectPenalty}
                  disabled={!penaltyEnabled}
                  aria-label="Penalty"
                >
                  -5
                </button>
                <div className="penalty-boxes" aria-label="Penalties">
                  {Array.from({ length: MAX_PENALTIES }, (_, index) => {
                    const selected = index < penalties || (turn.penalty && index === penalties);
                    return <span className={selected ? "penalty-box selected" : "penalty-box"} key={index} />;
                  })}
                </div>
              </div>
              <button
                className="opponent-penalty-button"
                type="button"
                onClick={endByOpponentPenalties}
                disabled={gameOver}
                aria-label="Opponent reached four penalties"
              >
                <AlertTriangle size={18} />
                <span>4x</span>
              </button>
            </div>

            <div className="score-guide" aria-label="Scoring guide">
              {SCORE_VALUES.slice(1).map((score, index) => (
                <span key={score}>
                  {index + 1}x {score}
                </span>
              ))}
            </div>

            <ScoreTotals rows={rows} penalties={penalties} turn={turn} totalScore={totalScore} />
          </section>
        </div>
      ) : null}

      {confirmAction ? (
        <ConfirmModal action={confirmAction} onCancel={cancelConfirmAction} onConfirm={confirmPendingAction} />
      ) : null}
    </main>
  );
}

function DiceGrid({
  enabled,
  onRoll,
  pale,
  roll,
  rollAnimationKey,
  rows,
}: {
  enabled: boolean;
  onRoll: () => void;
  pale: boolean;
  roll: DiceRoll | null;
  rollAnimationKey: number;
  rows: RowsState;
}) {
  return (
    <button className={pale ? "dice-grid pale" : "dice-grid"} type="button" onClick={onRoll} disabled={!enabled} aria-label="Roll dice">
      {DICE_LAYOUT.map((die) => {
        if (isRowColor(die.key) && rows[die.key].lock !== "none") {
          return null;
        }

        const value = roll ? roll[die.key as keyof DiceRoll] ?? null : null;

        return (
          <Die
            color={die.color}
            column={die.column}
            key={die.key}
            row={die.row}
            value={typeof value === "number" ? value : null}
            rollAnimationKey={rollAnimationKey}
          />
        );
      })}
    </button>
  );
}

function Die({
  color,
  column,
  row,
  rollAnimationKey,
  value,
}: {
  color: string;
  column: number;
  row: number;
  rollAnimationKey: number;
  value: number | null;
}) {
  const pipPositions: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  const positions = value ? pipPositions[value] : [];

  return (
    <span
      className={value ? `die ${color} rolled` : `die ${color} idle`}
      style={{ gridColumn: column, gridRow: row }}
      key={`${color}-${rollAnimationKey}-${value ?? "idle"}`}
    >
      {Array.from({ length: 9 }, (_, index) => (
        <span className={positions.includes(index) ? `pip p${index} visible` : `pip p${index}`} key={index} />
      ))}
    </span>
  );
}

function ScoreRow({
  canLock,
  gameOver,
  legalMarkKeys,
  legalMarkRoles,
  onSelectMark,
  onStageOpponentLock,
  row,
  rows,
  showHints,
  turn,
}: {
  canLock: boolean;
  gameOver: boolean;
  legalMarkKeys: Set<string>;
  legalMarkRoles: Map<string, Set<MarkRole>>;
  onSelectMark: (mark: ScoreMark) => void;
  onStageOpponentLock: (row: RowColor) => void;
  row: RowColor;
  rows: RowsState;
  showHints: boolean;
  turn: TurnDraft;
}) {
  const config = ROW_CONFIGS[row];
  const ownLock = rows[row].lock === "own" || hasStagedOwnLock(row, turn);
  const opponentLock = rows[row].lock === "opponent" || turn.opponentLocks.includes(row);
  const closed = rows[row].lock !== "none";

  return (
    <div className={`score-row ${row} ${closed ? "closed" : ""}`}>
      {config.numbers.map((number) => {
        const mark: ScoreMark = { row, number };
        const key = markKey(mark);
        const selected =
          rows[row].selected.includes(number) ||
          turn.selectedMarks.some((selectedMark) => markKey(selectedMark) === key);
        const legal = legalMarkKeys.has(key);
        const roles = legalMarkRoles.get(key);
        const whiteHint = showHints && Boolean(roles?.has("white"));
        const mixedHint = showHints && Boolean(roles?.has("mixed"));
        return (
          <button
            className={[
              "score-tile",
              selected ? "selected" : "",
              legal ? "legal" : "",
              whiteHint ? "hint-white" : "",
              mixedHint ? "hint-mixed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={number}
            type="button"
            onClick={() => onSelectMark(mark)}
            disabled={!legal || gameOver}
            aria-label={`${config.label} ${number}`}
          >
            <span>{number}</span>
          </button>
        );
      })}

      <button
        className={[
          "lock-tile",
          ownLock ? "own" : "",
          opponentLock ? "opponent" : "",
          canLock ? "legal" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        type="button"
        onClick={() => onStageOpponentLock(row)}
        disabled={!canLock || gameOver}
        aria-label={`${config.label} locked`}
      >
        <Lock size={17} />
      </button>
    </div>
  );
}

function ScoreTotals({
  penalties,
  rows,
  totalScore,
  turn,
}: {
  penalties: number;
  rows: RowsState;
  totalScore: number;
  turn: TurnDraft;
}) {
  return (
    <div className="totals-row" aria-label="Totals">
      {ROW_COLORS.map((row, index) => (
        <span className="total-piece" key={row}>
          {index > 0 ? <span className="operator">+</span> : null}
          <span className={`total-box ${row}`}>{getColorScore(row, rows, turn)}</span>
        </span>
      ))}
      <span className="operator">-</span>
      <span className="total-box penalty">{getPenaltyCount(penalties, turn) * PENALTY_POINTS}</span>
      <span className="operator">=</span>
      <strong className="grand-total">{totalScore}</strong>
    </div>
  );
}

function ConfirmModal({
  action,
  onCancel,
  onConfirm,
}: {
  action: "rollUndo" | "exit" | "startOver";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = {
    exit: {
      title: "Exit?",
      confirmLabel: "Exit",
    },
    rollUndo: {
      title: "Undo roll?",
      confirmLabel: "Undo",
    },
    startOver: {
      title: "Start over?",
      confirmLabel: "Reset",
    },
  }[action];

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{copy.title}</h2>
        <div className="confirm-actions">
          <button className="secondary" type="button" onClick={onCancel} aria-label="Cancel">
            <X size={18} />
          </button>
          <button className="primary" type="button" onClick={onConfirm}>
            {copy.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export default App;
