/**
 * Security claims this site publishes on more than one surface, spelled once.
 *
 * ROUND3-P2. The training-data assurance was typed three times -- as a `/security` control row,
 * as a Landing V2 trust proof, and as the first `/contact` FAQ answer -- and the three had
 * already drifted: two said "your world" and one said "your World". Contract rule 5's own
 * reasoning applies to a claim as much as to a figure, because a second spelling of a published
 * claim is a second claim, and `PRODUCT_NOUNS` in `lib/site-navigation.ts` makes "World" the
 * capitalised product noun. So the sentence lives here and the three surfaces read it.
 *
 * English only. Korean copy is a literal translation held in the module that owns the Korean
 * surface (`lib/landing-v2-copy.ts` for the landing), which is D12's rule: a translation is not a
 * second English claim and does not belong in the canonical constant.
 *
 * What may be added here: a sentence that already appears on two or more surfaces. What may not:
 * a new claim. Wording is a founder call, so this module moves an existing sentence and never
 * writes one.
 */
export const TRAINING_DATA_CLAIM = {
  label: "Your data is not training data",
  body: "Your documents are not used to train shared models. Models read your sources to compile your World, and for nothing else.",
} as const;
