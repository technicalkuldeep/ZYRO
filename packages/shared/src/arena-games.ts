export const gameDefinitions = [
  {
    key: "quick-draw",
    name: "Above or Below 50",
    type: "quick",
    category: "Quick Predictions",
    tagline: "One number. Your call.",
    choices: ["YES", "NO"],
    labels: ["Above · 50–99", "Below · 0–49"],
    rules: "Draw 0–99 uniformly. YES wins on 50–99; NO on 0–49.",
    visual: "number",
    accent: "jade",
  },
  {
    key: "coin-flip",
    name: "Coin Flip",
    type: "quick",
    category: "Quick Predictions",
    tagline: "Two sides. One instinct.",
    choices: ["HEADS", "TAILS"],
    labels: ["Heads", "Tails"],
    rules: "A fair coin is drawn. Match the side to win.",
    visual: "coin",
    accent: "gold",
  },
  {
    key: "dice-duel",
    name: "Dice Duel",
    type: "quick",
    category: "Quick Predictions",
    tagline: "Let the dice do the talking.",
    choices: ["ABOVE", "BELOW"],
    labels: ["Above 7 · 8–12", "Below 7 · 2–6"],
    rules:
      "Two independent fair six-sided dice. Above 7 or below 7 wins. Exactly 7 refunds the stake.",
    visual: "dice",
    accent: "mint",
  },
  {
    key: "red-black",
    name: "Red or Black",
    type: "quick",
    category: "Quick Predictions",
    tagline: "A little colour. A clear choice.",
    choices: ["RED", "BLACK"],
    labels: ["Red · Hearts / Diamonds", "Black · Clubs / Spades"],
    rules:
      "One card drawn uniformly from 52 cards. Hearts and diamonds are red; clubs and spades black.",
    visual: "card",
    accent: "rose",
  },
  {
    key: "triple-flip",
    name: "Triple Flip",
    type: "quick",
    category: "Quick Predictions",
    tagline: "Three flips. Find the majority.",
    choices: ["HEADS", "TAILS"],
    labels: ["Majority Heads", "Majority Tails"],
    rules:
      "Three independent fair coin flips. Two or three matching sides form the majority. No ties.",
    visual: "triple",
    accent: "gold",
  },
  {
    key: "rock-paper-scissors",
    name: "Rock Paper Scissors",
    type: "bot",
    category: "Challenge the Bot",
    tagline: "Your move. Signal’s secret.",
    choices: ["ROCK", "PAPER", "SCISSORS"],
    labels: ["Rock", "Paper", "Scissors"],
    rules:
      "Signal commits before your final choice. Rock beats scissors, scissors beats paper, paper beats rock. Equal choices refund your stake.",
    visual: "rps",
    accent: "mint",
  },
  {
    key: "lucky-number",
    name: "Lucky Number Duel",
    type: "bot",
    category: "Challenge the Bot",
    tagline: "Your number against Signal’s.",
    choices: ["PLAY"],
    labels: ["Deal our numbers"],
    rules:
      "You and Signal each receive an independent uniform integer from 1–100. Higher wins. Equal numbers refund your stake.",
    visual: "duel",
    accent: "jade",
  },
] as const;
export type GameKey = (typeof gameDefinitions)[number]["key"];
export const categories = [
  "All",
  "Crypto",
  "Quick Predictions",
  "Challenge the Bot",
  "Politics",
  "Sports",
  "Games",
  "Technology",
  "Economics",
] as const;
export type GameResult = {
  values: number[];
  label: string;
  bot?: string;
  verdict: "WIN" | "LOSS" | "TIE";
};
export function gameDefinition(key: string) {
  return gameDefinitions.find((g) => g.key === key);
}
