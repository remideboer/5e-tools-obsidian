import {monsterCount} from "../obsidian/src/encounter-size.js";

const XP = {
	"0": 10,
	"1/8": 25,
	"1/4": 50,
	"1/2": 100,
	"1": 200,
	"2": 450,
	"3": 700,
	"4": 1100,
	"5": 1800,
	"6": 2300,
	"7": 2900,
	"8": 3900,
	"9": 5000,
	"10": 5900,
	"11": 7200,
	"12": 8400,
	"13": 10000,
	"14": 11500,
	"15": 13000,
	"16": 15000,
	"17": 18000,
	"18": 20000,
	"19": 22000,
	"20": 25000,
};

globalThis.Parser = {
	crToXpNumber (cr) {
		const key = cr && typeof cr === "object" ? cr.cr : cr;
		return XP[String(key)] ?? null;
	},
};

function assertEqual (actual, expected, label) {
	if (actual !== expected) {
		throw new Error(`${label}: expected ${expected}, got ${actual}`);
	}
}

const party = {level: 1, partyCount: 4, difficulty: "medium", style: "classic"};
const crQuarter = monsterCount({...party, cr: "1/4"});
const crOne = monsterCount({...party, cr: "1"});
const crQuarterFirst = monsterCount({...party, cr: "1/4", playersFirst: true});
const crOneFirst = monsterCount({...party, cr: "1", playersFirst: true});
const crFifteen = monsterCount({...party, cr: "15"});
const crFifteenFirst = monsterCount({...party, cr: "15", playersFirst: true});

// Four level-1 characters, medium (200 XP). CR 1/4 is 50 XP and 1 attack:
// 2 monsters → 100 × 1.5 = 150; 3 monsters → 150 × 2 = 300.
assertEqual(crQuarter, 2, "classic CR 1/4");
// CR 1 is 200 XP and 2 attacks: 1 monster → 200 × 1.5 = 300, over budget.
assertEqual(crOne, null, "classic CR 1");
assertEqual(crQuarterFirst, 4, "players first CR 1/4");
assertEqual(crOneFirst, 1, "players first CR 1");
assertEqual(crFifteen, null, "classic CR 15");
assertEqual(crFifteenFirst, null, "players first CR 15");

const lowGap = (crQuarterFirst ?? 0) - (crQuarter ?? 0);
const highGap = (crFifteenFirst ?? 0) - (crFifteen ?? 0);
if (lowGap <= highGap) {
	throw new Error(`low-CR gap ${lowGap} should be larger than CR 15 gap ${highGap}`);
}

assertEqual(
	monsterCount({level: 1, partyCount: 4, difficulty: "moderate", style: "one", cr: "1/4"}),
	6,
	"2024 moderate CR 1/4",
);

const crs = ["1/8", "1/4", "1", "5", "10", "15"];
for (const level of [1, 5, 11, 20]) {
	for (const difficulty of ["easy", "medium", "hard", "deadly"]) {
		for (const cr of crs) {
			const standard = monsterCount({level, partyCount: 4, difficulty, style: "classic", cr}) ?? 0;
			const first = monsterCount({level, partyCount: 4, difficulty, style: "classic", cr, playersFirst: true}) ?? 0;
			if (first < standard) {
				throw new Error(`players first ${first} < standard ${standard} at level ${level} ${difficulty} CR ${cr}`);
			}
		}
	}
}

console.log("encounter size checks passed");
