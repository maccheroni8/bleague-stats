// GitHub Actionsから `SEASON=$(node ... print-current-season.ts)` のように呼ぶための小さなCLI。
import { currentSeason } from "./lib/season.ts";

console.log(currentSeason());
