/**
 * Logistic Regression Weight Training Script
 *
 * Learns optimal factor weights from historical prediction outcomes instead of
 * relying on hand-tuned hardcoded weights.
 *
 * How it works:
 * 1. Reads all resolved PredictionResult rows from the database
 * 2. For each prediction, extracts the factor contributions (stored in factorsJson)
 * 3. Trains a logistic regression model: P(home_wins) = sigmoid(sum(weight_i * factor_i))
 * 4. Outputs the learned weights per sport, which can be compared to the hardcoded ones
 * 5. Optionally writes a JSON config file that the engine can load at runtime
 *
 * The model uses L2 regularization to prevent overfitting on small sample sizes.
 * Cross-validation is used to estimate out-of-sample accuracy.
 *
 * Usage:
 *   bun run src/scripts/trainFactorWeights.ts [--sport NBA] [--output weights.json]
 *
 * Requirements:
 *   - At least 50 resolved predictions per sport for meaningful training
 *   - factorsJson must be populated in PredictionResult (added in v2.8+)
 */

import { prisma } from "../prisma";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TrainingExample {
  features: Record<string, number>; // factor key → weighted delta
  outcome: 0 | 1; // 0 = away won, 1 = home won
  sport: string;
}

interface LearnedWeights {
  sport: string;
  weights: Record<string, number>;
  intercept: number;
  accuracy: number;
  sampleSize: number;
  crossValAccuracy: number;
  timestamp: string;
}

// ─── Sigmoid & Logistic Regression ──────────────────────────────────────────

function sigmoid(x: number): number {
  if (x > 500) return 1;
  if (x < -500) return 0;
  return 1 / (1 + Math.exp(-x));
}

/**
 * Train logistic regression using gradient descent with L2 regularization.
 * Returns weights and intercept.
 */
function trainLogisticRegression(
  examples: Array<{ features: number[]; label: 0 | 1 }>,
  featureNames: string[],
  options: {
    learningRate?: number;
    epochs?: number;
    l2Lambda?: number;
  } = {}
): { weights: number[]; intercept: number } {
  const { learningRate = 0.01, epochs = 2000, l2Lambda = 0.01 } = options;
  const nFeatures = featureNames.length;

  // Initialize weights to small random values
  const weights = new Array(nFeatures).fill(0).map(() => (Math.random() - 0.5) * 0.01);
  let intercept = 0;

  const n = examples.length;
  if (n === 0) return { weights, intercept };

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Compute gradients
    const gradW = new Array(nFeatures).fill(0);
    let gradB = 0;

    for (const example of examples) {
      const z = example.features.reduce((sum, f, i) => sum + f * weights[i]!, 0) + intercept;
      const pred = sigmoid(z);
      const error = pred - example.label;

      for (let i = 0; i < nFeatures; i++) {
        gradW[i]! += error * example.features[i]!;
      }
      gradB += error;
    }

    // Update weights with L2 regularization
    for (let i = 0; i < nFeatures; i++) {
      weights[i]! -= learningRate * (gradW[i]! / n + l2Lambda * weights[i]!);
    }
    intercept -= learningRate * (gradB / n);
  }

  return { weights, intercept };
}

/**
 * Evaluate accuracy of a trained model on a test set.
 */
function evaluateAccuracy(
  examples: Array<{ features: number[]; label: 0 | 1 }>,
  weights: number[],
  intercept: number
): number {
  if (examples.length === 0) return 0;
  let correct = 0;
  for (const example of examples) {
    const z = example.features.reduce((sum, f, i) => sum + f * weights[i]!, 0) + intercept;
    const pred = sigmoid(z) >= 0.5 ? 1 : 0;
    if (pred === example.label) correct++;
  }
  return correct / examples.length;
}

/**
 * K-fold cross-validation to estimate out-of-sample accuracy.
 */
function crossValidate(
  examples: Array<{ features: number[]; label: 0 | 1 }>,
  featureNames: string[],
  k = 5
): number {
  if (examples.length < k * 2) return 0;

  // Shuffle examples
  const shuffled = [...examples].sort(() => Math.random() - 0.5);
  const foldSize = Math.floor(shuffled.length / k);
  let totalAccuracy = 0;

  for (let fold = 0; fold < k; fold++) {
    const testStart = fold * foldSize;
    const testEnd = testStart + foldSize;
    const testSet = shuffled.slice(testStart, testEnd);
    const trainSet = [...shuffled.slice(0, testStart), ...shuffled.slice(testEnd)];

    const { weights, intercept } = trainLogisticRegression(trainSet, featureNames, {
      epochs: 1500,
      l2Lambda: 0.02,
    });

    totalAccuracy += evaluateAccuracy(testSet, weights, intercept);
  }

  return totalAccuracy / k;
}

// ─── Data Loading ───────────────────────────────────────────────────────────

async function loadTrainingData(sportFilter?: string): Promise<TrainingExample[]> {
  const results = await prisma.predictionResult.findMany({
    where: {
      actualWinner: { not: null },
      ...(sportFilter ? { sport: sportFilter } : {}),
    },
    select: {
      sport: true,
      actualWinner: true,
      homeTeamName: true,
      awayTeamName: true,
      canonicalJson: true,
    },
  });

  const examples: TrainingExample[] = [];

  for (const result of results) {
    if (!result.canonicalJson || !result.actualWinner) continue;

    let canonical: any;
    try {
      canonical = typeof result.canonicalJson === "string"
        ? JSON.parse(result.canonicalJson)
        : result.canonicalJson;
    } catch {
      continue;
    }

    const factors = canonical?.factors;
    if (!factors || !Array.isArray(factors)) continue;

    const features: Record<string, number> = {};
    for (const factor of factors) {
      if (factor.key && typeof factor.homeDelta === "number" && factor.available) {
        // Normalize delta to roughly [-1, 1] range for training stability
        features[factor.key] = factor.homeDelta / 100;
      }
    }

    if (Object.keys(features).length < 2) continue;

    // Determine outcome: 1 = home won, 0 = away won
    // Skip draws for binary classification
    const homeWon = result.actualWinner === "home";
    const awayWon = result.actualWinner === "away";
    if (!homeWon && !awayWon) continue;

    examples.push({
      features,
      outcome: homeWon ? 1 : 0,
      sport: result.sport,
    });
  }

  return examples;
}

// ─── Main Training Pipeline ─────────────────────────────────────────────────

async function trainForSport(sport: string, examples: TrainingExample[]): Promise<LearnedWeights | null> {
  const sportExamples = examples.filter((e) => e.sport === sport);
  if (sportExamples.length < 30) {
    console.log(`  ⚠ ${sport}: Only ${sportExamples.length} examples (need 30+), skipping`);
    return null;
  }

  // Collect all unique feature keys across examples
  const allKeys = new Set<string>();
  for (const ex of sportExamples) {
    for (const key of Object.keys(ex.features)) {
      allKeys.add(key);
    }
  }
  const featureNames = Array.from(allKeys).sort();

  // Convert to numeric arrays (missing features = 0)
  const numericExamples = sportExamples.map((ex) => ({
    features: featureNames.map((key) => ex.features[key] ?? 0),
    label: ex.outcome,
  }));

  // Train
  const { weights, intercept } = trainLogisticRegression(numericExamples, featureNames, {
    learningRate: 0.005,
    epochs: 3000,
    l2Lambda: 0.015,
  });

  // Evaluate
  const trainAccuracy = evaluateAccuracy(numericExamples, weights, intercept);
  const cvAccuracy = crossValidate(numericExamples, featureNames, 5);

  // Build weight map
  const weightMap: Record<string, number> = {};
  for (let i = 0; i < featureNames.length; i++) {
    weightMap[featureNames[i]!] = weights[i]!;
  }

  return {
    sport,
    weights: weightMap,
    intercept,
    accuracy: trainAccuracy,
    sampleSize: sportExamples.length,
    crossValAccuracy: cvAccuracy,
    timestamp: new Date().toISOString(),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const sportIdx = args.indexOf("--sport");
  const sportFilter = sportIdx >= 0 ? args[sportIdx + 1] : undefined;
  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : undefined;

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Logistic Regression Factor Weight Training                 ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  console.log("Loading training data from PredictionResult...");
  const examples = await loadTrainingData(sportFilter);
  console.log(`  Loaded ${examples.length} resolved predictions with factor data`);
  console.log();

  // Group by sport
  const sportCounts = new Map<string, number>();
  for (const ex of examples) {
    sportCounts.set(ex.sport, (sportCounts.get(ex.sport) ?? 0) + 1);
  }

  console.log("Per-sport sample sizes:");
  for (const [sport, count] of Array.from(sportCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${sport}: ${count} games`);
  }
  console.log();

  // Train per sport
  const results: LearnedWeights[] = [];
  const sports = sportFilter ? [sportFilter] : Array.from(sportCounts.keys());

  for (const sport of sports) {
    console.log(`Training ${sport}...`);
    const result = await trainForSport(sport, examples);
    if (result) {
      results.push(result);
      console.log(`  ✓ ${sport}: Train accuracy ${(result.accuracy * 100).toFixed(1)}%, CV accuracy ${(result.crossValAccuracy * 100).toFixed(1)}% (n=${result.sampleSize})`);

      // Show top weights
      const sorted = Object.entries(result.weights)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 8);
      console.log(`  Top factors by learned importance:`);
      for (const [key, weight] of sorted) {
        const bar = "█".repeat(Math.min(20, Math.round(Math.abs(weight) * 10)));
        console.log(`    ${key.padEnd(25)} ${weight > 0 ? "+" : ""}${weight.toFixed(4)} ${bar}`);
      }
      console.log();
    }
  }

  // Output results
  if (outputPath && results.length > 0) {
    const { writeFile } = await import("fs/promises");
    const output = {
      version: "1.0.0",
      trainedAt: new Date().toISOString(),
      totalExamples: examples.length,
      sports: results,
    };
    await writeFile(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nWeights written to: ${outputPath}`);
  }

  // Summary comparison with hardcoded weights
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("SUMMARY: Learned vs Hardcoded Weight Comparison");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log();
  console.log("The learned weights show which factors ACTUALLY predict outcomes");
  console.log("vs which factors the engine currently over/under-weights.");
  console.log();
  console.log("Key insights:");
  console.log("  - Factors with high learned weight are genuinely predictive");
  console.log("  - Factors with near-zero learned weight add noise, not signal");
  console.log("  - The intercept captures home advantage not explained by factors");
  console.log();

  for (const result of results) {
    const homeAdvantage = sigmoid(result.intercept);
    console.log(`${result.sport}: Baseline home win prob = ${(homeAdvantage * 100).toFixed(1)}% (intercept = ${result.intercept.toFixed(3)})`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Training failed:", err);
  process.exit(1);
});
