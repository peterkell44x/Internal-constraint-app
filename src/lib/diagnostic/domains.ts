// Ported verbatim from the standalone prototype
// (internal-constraint-diagnostic.html). The prompt text in this file has been
// tuned through live testing: do not reword it. Only type annotations and
// `export` keywords were added.

export type DomainKey = "money" | "relationships" | "fitness" | "happiness";

export interface Domain {
  label: string;
  subtitle: string;
  reportTitle: string;
  topicPhrase: string;
  frameworkNote: string;
  verbalDef: string;
  modelDef: string;
  consciousExample: string;
  subconsciousExample: string;
  goalPhrase: string;
  goalWord: string;
}

// ---- Domain definitions ----
// Every field below is the ONLY thing that changes between domains.
// All behavioral rules (dash stripping, readiness marker, hard ceiling,
// relevance rule, anti assumption rule, neutrality rule) live once in the
// shared template functions further down and never change per domain.
export const DOMAINS: Record<DomainKey, Domain> = {
  money: {
    label: 'Money & Abundance',
    subtitle: 'Money & abundance domain',
    reportTitle: 'money blueprint',
    topicPhrase: 'money and abundance conditioning',
    frameworkNote: 'based on the framework from Secrets of the Millionaire Mind by T. Harv Eker',
    verbalDef: 'what they heard repeated growing up about money',
    modelDef: 'what they watched the people around them do with money',
    consciousExample: 'Someone can say all day that money is good, that they want to be rich, that they deserve success, and that is their conscious belief.',
    subconsciousExample: 'consciously wanting money while subconsciously associating money with difficulty, danger, or not being for people like them',
    goalPhrase: 'the money, the business success, and the abundance they want',
    goalWord: 'money'
  },
  relationships: {
    label: 'Love & Relationships',
    subtitle: 'Love & relationships domain',
    reportTitle: 'relationship blueprint',
    topicPhrase: 'love and relationship conditioning',
    frameworkNote: 'using the same verbal programming, modeling, and specific incidents framework the money blueprint model is built on, applied here to love and relationships',
    verbalDef: 'what they heard repeated growing up about love, relationships, marriage, or being wanted',
    modelDef: 'what they watched the people around them do in their own relationships, such as how their parents or caregivers loved, fought, stayed, or left',
    consciousExample: 'Someone can say all day that they want real love, that they are ready for a partner, that they deserve to be loved well, and that is their conscious belief.',
    subconsciousExample: 'consciously wanting real connection while subconsciously associating closeness with abandonment, danger, suffocation, or not being safe',
    goalPhrase: 'the relationship, the connection, and the love they want',
    goalWord: 'love'
  },
  fitness: {
    label: 'Fitness & Health',
    subtitle: 'Fitness & health domain',
    reportTitle: 'body blueprint',
    topicPhrase: 'body and health conditioning',
    frameworkNote: 'using the same verbal programming, modeling, and specific incidents framework the money blueprint model is built on, applied here to the body and health',
    verbalDef: 'what they heard repeated growing up about their body, food, weight, or discipline',
    modelDef: 'what they watched the people around them do with their own body, food, or exercise',
    consciousExample: 'Someone can say all day that they want to be strong and healthy, that they care about their body, and that is their conscious belief.',
    subconsciousExample: 'consciously wanting a strong healthy body while subconsciously associating effort with punishment, food with comfort or danger, or their body with something to hide',
    goalPhrase: 'the body, the health, and the physical vitality they want',
    goalWord: 'body'
  },
  happiness: {
    label: 'Happiness & Peace',
    subtitle: 'Happiness & peace domain',
    reportTitle: 'peace blueprint',
    topicPhrase: 'happiness and inner peace conditioning',
    frameworkNote: 'using the same verbal programming, modeling, and specific incidents framework the money blueprint model is built on, applied here to happiness and peace',
    verbalDef: 'what they heard repeated growing up about happiness, rest, deserving good things, or being at peace',
    modelDef: 'what they watched the people around them do with joy, rest, contentment, or their own sense of worth',
    consciousExample: 'Someone can say all day that they want to feel at peace, that they deserve to be happy, and that is their conscious belief.',
    subconsciousExample: 'consciously wanting peace while subconsciously associating rest with laziness, contentment with danger, or happiness with something that gets taken away',
    goalPhrase: 'the peace, the happiness, and the contentment they want',
    goalWord: 'peace'
  }
};

// Short descriptions shown on the domain picker buttons.
export const DOMAIN_BLURBS: Record<DomainKey, string> = {
  money: "Your relationship with money, work, and building something of your own",
  relationships: "Your relationship with connection, intimacy, and being with someone",
  fitness: "Your relationship with your body, food, and discipline",
  happiness: "Your relationship with rest, contentment, and your own worth",
};

export const DOMAIN_KEYS = Object.keys(DOMAINS) as DomainKey[];

export function isDomainKey(value: unknown): value is DomainKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DOMAINS, value);
}
