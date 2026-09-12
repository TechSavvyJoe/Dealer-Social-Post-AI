import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { captionUsesOnlyExpectedCustomer } from "../utils/captionQuality";

/**
 * The customer-name guard runs twice on every post: once in the browser
 * (utils/captionQuality.ts, at generation and before save) and again on the
 * server (pb_hooks/websitePublications.js, on save, on History projection,
 * and on website send). Any caption the two disagree on is a post that
 * either generates and then refuses to save, or saves and then shows
 * "Caption held for customer-name review." in History. Run one corpus through
 * both and require identical verdicts.
 */
function loadPocketBaseCommonJs<T>(relativePath: string): T {
  const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
  const module = { exports: {} as T };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

interface WebsitePublications {
  containsUnexpectedCustomerIdentity(
    text: string,
    expectedCustomer: string | undefined,
    allowedPhrases: unknown[],
  ): boolean;
  groundedIdentityPhrase(phrase: string): { phrase: string; grounded: true };
}

const website = loadPocketBaseCommonJs<WebsitePublications>(
  "pb_hooks/websitePublications.js",
);

const DEALER = "Bob Maxey Ford of Howell";
const OEM = "Ford";
const SALESPERSON = "Joe Gallant";

const serverVerdict = (caption: string, customer?: string, vehicle?: string) =>
  !website.containsUnexpectedCustomerIdentity(caption, customer, [
    website.groundedIdentityPhrase(DEALER),
    website.groundedIdentityPhrase(OEM),
    SALESPERSON,
    "Joe",
    website.groundedIdentityPhrase(vehicle || ""),
  ]);

const clientVerdict = (caption: string, customer?: string, vehicle?: string) =>
  captionUsesOnlyExpectedCustomer(caption, customer, {
    allowedPhrases: [DEALER, OEM, vehicle],
    maskedPhrases: [SALESPERSON, "Joe"],
    rejectAnyCustomerIdentity: !customer,
  });

const corpus: Array<{
  caption: string;
  customer?: string;
  vehicle?: string;
  safe: boolean;
}> = [
  // Ordinary Customer Delivery copy with no customer supplied.
  {
    caption: "Big smiles today! Ford is proud to hand over another set of keys.",
    safe: true,
  },
  {
    caption: "This Bronco is ready for its first adventure with its proud new owner.",
    safe: true,
  },
  {
    caption: "The Explorer is heading home today. Congratulations on the new ride!",
    safe: true,
  },
  { caption: "Your new Mustang has every option you asked for.", safe: true },
  { caption: "Her shiny new Escape just found its forever home.", safe: true },
  {
    caption:
      "Delivered: Ford Bronco Sport. Another happy customer at Bob Maxey Ford of Howell.",
    safe: true,
  },
  { caption: "Congrats, Ford family! Another happy delivery.", safe: true },
  { caption: "Meet Howell's newest Bronco Sport owner!", safe: true },
  // A lone dealer word in a vocative slot is refused on purpose: the guard
  // cannot tell the town from the founder's first name ("Welcome to the
  // family, Bob!"), and the person reading wins.
  { caption: "Welcome to the family, Howell!", safe: false },
  { caption: "Congrats, Ford family! Welcome to the Maxey Ford team.", safe: true },
  { caption: "Thank you from Ford of Howell!", safe: true },
  { caption: "Greetings from Howell.", safe: true },
  { caption: "Huge shout-out to Bob Maxey Ford's delivery team!", safe: true },
  { caption: "Straight from Ford, built for Michigan roads.", safe: true },
  {
    caption: "Maxey Ford has done it again — another set of keys handed over.",
    safe: true,
  },
  {
    caption: "Bob Maxey Ford of Howell is thrilled to celebrate another delivery.",
    safe: true,
  },
  {
    caption: "All smiles as another driver takes the keys at Bob Maxey Ford of Howell.",
    safe: true,
  },
  {
    caption: "Congratulations to the Howell family on their new Expedition!",
    safe: true,
  },
  // Ordinary name-free copy the review found still refused.
  {
    caption:
      "Big smiles today! This Bronco Sport is ready for every Michigan adventure.",
    safe: true,
  },
  { caption: "Your new Bronco Sport is ready.", safe: true },
  { caption: "This F-150 Lariat is ready for work.", safe: true },
  { caption: "This Mustang Mach-E is ready.", safe: true },
  { caption: "Your all-new 2025 Bronco is here.", safe: true },
  { caption: "This Ford Bronco is heading home.", safe: true },
  // A make followed by an unknown capitalized word is "Ford Bronco Sport" or
  // "Ford Johnson" and the guard cannot tell which until a VIN grounds the
  // model — so it is a thing only once the VIN is scanned, and a person
  // otherwise. A determiner settles it either way ("This Ford Bronco Sport").
  {
    caption: "Ford Bronco Sport is heading home!",
    vehicle: "2025 Ford Bronco Sport Big Bend",
    safe: true,
  },
  { caption: "Ford Bronco Sport is heading home!", safe: false },
  { caption: "This Ford Bronco Sport is heading home!", safe: true },
  { caption: "Today is a great day for a new ride. Visit us in Howell.", safe: true },
  { caption: "Everything is ready for delivery day.", safe: true },
  { caption: "Keys are in hand and the adventure begins.", safe: true },
  { caption: "With love from Howell.", safe: true },
  { caption: "Much love, Howell!", safe: true },
  { caption: "Sending love from Bob Maxey Ford of Howell!", safe: true },
  { caption: "Welcome to the Bob Maxey Ford of Howell Family!", safe: true },
  { caption: "Bob Maxey Ford of Howell Team is proud.", safe: true },
  {
    caption: "Thanks for choosing Bob Maxey Ford of Howell\nStop by and see us!",
    safe: true,
  },
  { caption: "Big smiles today!\nThis Bronco is heading home.", safe: true },
  { caption: "Meet the Ford Bronco Sport Big Bend!", safe: true },
  // A VIN was scanned, so the model name is grounded.
  {
    caption: "Bronco is ready for adventure. Stop by Bob Maxey Ford of Howell.",
    vehicle: "2025 Ford Bronco Big Bend",
    safe: true,
  },
  // Real people the guard must still refuse — including everything the
  // adversarial review found leaking through the first draft of the
  // widened exemption.
  { caption: "Congrats to Michelle on her new Bronco!", safe: false },
  { caption: "Congrats to Ford Johnson on his brand new Explorer!", safe: false },
  { caption: "Meet Ford Johnson, our newest Bronco owner!", safe: false },
  { caption: "Welcome home, Ford Johnson!", safe: false },
  { caption: "Congrats to Bob Howell on his brand new Explorer!", safe: false },
  { caption: "Welcome home, Bob Howell!", safe: false },
  { caption: "Meet Bob Ford, the newest member of the family!", safe: false },
  { caption: "Congrats to Bob on his brand new Explorer!", safe: false },
  { caption: "Congrats to Bob Maxey on his brand new Explorer!", safe: false },
  { caption: "Welcome to the family, Bob!", safe: false },
  { caption: "Congrats to Ford Bronco owner Sarah!", safe: false },
  { caption: "Delivered: Ford Bronco Sport to Michelle Johnson!", safe: false },
  { caption: "Congrats to Bob Maxey Ford's newest customer, Michelle!", safe: false },
  { caption: "Meet Howell's newest owner Sarah!", safe: false },
  { caption: "The Johnson's are all smiles today!", safe: false },
  { caption: "The Smiths' are all smiles today!", safe: false },
  { caption: "Our very own Sarah just took home her dream Bronco!", safe: false },
  { caption: "Our amazing Sarah is all smiles with her new Explorer.", safe: false },
  {
    caption:
      "Nothing beats a delivery like this\nMichelle is officially a Bronco owner!",
    safe: false,
  },
  { caption: "Sarah Smith is thrilled with her new Bronco.", safe: false },
  { caption: "Our Sarah Ford is thrilled with her Explorer.", safe: false },
  { caption: "The Johnsons love their new Explorer.", safe: false },
  { caption: "Sarah and Mike love their new Explorer.", safe: false },
  { caption: "Michelle is all smiles with her new Bronco.", safe: false },
  { caption: "Sarah has the keys to her new Escape!", safe: false },
  { caption: "Congrats to Sarah Ford on her brand new Explorer!", safe: false },
  { caption: "Congratulations, Bob Smith!", safe: false },
  { caption: "Meet Michelle Maxey! The whole team is excited.", safe: false },
  { caption: "Welcome home, Jordan Howell!", safe: false },
  { caption: "Michelle smiling beside her brand new Bronco.", safe: false },
  { caption: "Her friend Michelle is thrilled with the new Bronco.", safe: false },
  { caption: "We're thrilled that Sarah is part of the family.", safe: false },
  { caption: "The Johnsons are all smiles today.", safe: false },
  { caption: "Jordan and Ford are picking up their new Explorer today.", safe: false },
  // The salesperson is grounded prose, never the celebrated customer.
  { caption: "Ask for Joe Gallant at Bob Maxey Ford of Howell.", safe: true },
  { caption: "Joe Gallant is here to help you find your next ride.", safe: true },
  { caption: "Congratulations to Joe Gallant on the new Bronco!", safe: false },
  { caption: "Congrats to Joe on his new Bronco!", safe: false },
  // With an authorized first name, only that name may appear.
  {
    caption: "Congrats to Michelle on her new Bronco!",
    customer: "Michelle",
    safe: true,
  },
  {
    caption: "Congrats to Michelle Smith on her new Bronco!",
    customer: "Michelle",
    safe: false,
  },
  {
    caption: "Michelle and Sarah love the new Explorer.",
    customer: "Michelle",
    safe: false,
  },
  // ---- Round-2 adversarial review: every shape that was shipping a real
  // person's name through both guards before the v3 rewrite. ----
  { caption: "Congrats to Ford Johnson on his brand new Explorer!", safe: false },
  { caption: "Congrats to Lincoln Nguyen on her new Corsair!", safe: false },
  { caption: "Ford Johnson is thrilled with his new Explorer.", safe: false },
  { caption: "Mercedes Johnson is thrilled with her new Explorer.", safe: false },
  // A possessive business run handing off to a person.
  {
    caption: "Congrats to Bob Maxey Ford's newest Bronco owner, Michelle!",
    safe: false,
  },
  { caption: "Meet Bob Maxey Ford's newest Explorer owner, Michelle!", safe: false },
  { caption: "Meet Howell's newest Bronco owner, Michelle!", safe: false },
  {
    caption: "Congrats to Bob Maxey Ford's newest owners, the Johnsons!",
    safe: false,
  },
  {
    caption: "Congrats to Bob Maxey Ford of Howell's newest customer, Michelle!",
    safe: false,
  },
  { caption: "Meet Bob Maxey Ford of Howell's newest owner, Sarah!", safe: false },
  // A lowercase lead-in between the opener and the person.
  { caption: "Congrats to our newest customer, Michelle!", safe: false },
  { caption: "Congrats to our newest Bronco owner, Michelle Smith!", safe: false },
  { caption: "Congrats to repeat customer Michelle Smith!", safe: false },
  { caption: "Congrats to the Johnson family on their new Expedition!", safe: false },
  { caption: "Congratulations to the Johnsons on their new Expedition!", safe: false },
  { caption: "Sold to the Johnsons!", safe: false },
  // "Welcome to <anything>, Name" and trailing vocatives.
  { caption: "Welcome to the Ford family, Michelle!", safe: false },
  { caption: "Welcome to the Bob Maxey Ford family, Michelle!", safe: false },
  { caption: "Welcome aboard, Michelle!", safe: false },
  { caption: "Michelle Smith, welcome to Bronco Nation!", safe: false },
  { caption: "Thank you, Michelle, for choosing Bob Maxey Ford!", safe: false },
  { caption: "Enjoy the ride, Michelle!", safe: false },
  { caption: "Kudos to Michelle Smith!", safe: false },
  { caption: "Thanks to Sarah for the referral.", safe: false },
  // Unlisted verbs and two-word names after for/with/from.
  { caption: "Michelle was all smiles today!", safe: false },
  { caption: "The Johnsons got the keys to their new Expedition!", safe: false },
  { caption: "Delivery day for Michelle Smith!", safe: false },
  { caption: "New car day for Michelle Smith!", safe: false },
  { caption: "Big smiles from Michelle Smith today!", safe: false },
  { caption: "A new Bronco for the Smiths!", safe: false },
  { caption: "Sarah and her husband Mike love their new Explorer.", safe: false },
  // A lone founder/town word in a person slot.
  { caption: "Bob is all smiles with his new Bronco!", safe: false },
  { caption: "Howell is all smiles with her new Escape!", safe: false },
  { caption: "Congrats from Bob!", safe: false },
  { caption: "Welcome home, Bob Maxey!", safe: false },
  { caption: "Meet Bob Maxey, the newest member of the family!", safe: false },
  // Family possessive owning the vehicle.
  { caption: "The Johnsons' new Explorer is ready for adventure!", safe: false },
  { caption: "The Smith's new Bronco is ready.", safe: false },
  // Headline tail after a forgiven vehicle run.
  { caption: "Delivered: Ford Bronco Sport — Michelle Johnson!", safe: false },
  {
    caption: "Delivered: Ford Bronco Sport — Sarah!",
    customer: "Michelle",
    safe: false,
  },
  // A second person alongside the authorized one.
  {
    caption: "Michelle and her son Jake love the new Explorer.",
    customer: "Michelle",
    safe: false,
  },
  {
    caption: "Michelle is all smiles. Her husband Bob is too!",
    customer: "Michelle",
    safe: false,
  },
  {
    caption: "Congrats Michelle! Thanks to Sarah for the referral.",
    customer: "Michelle",
    safe: false,
  },
  // ---- And the name-free copy the same review found being refused. ----
  { caption: "Your Ford is back on the road.", safe: true },
  { caption: "Your Ford has been serviced and is ready for winter.", safe: true },
  { caption: "The Bronco is ready.", vehicle: "2025 Ford Bronco Big Bend", safe: true },
  { caption: "Their new Bronco Sport is ready.", safe: true },
  { caption: "Congrats to Bob Maxey Ford's newest F-150 owner!", safe: true },
  {
    caption: "Welcome to the family! Stop by Bob Maxey Ford of Howell today.",
    safe: true,
  },
  { caption: "Congratulations! Big smiles all around today.", safe: true },
  { caption: "Ask for Joe at Bob Maxey Ford of Howell.", safe: true },
  { caption: "Joe is here to help you find the right one.", safe: true },
  { caption: "Our Service Department is ready for winter.", safe: true },
  { caption: "Memorial Day is the perfect time to visit.", safe: true },
  { caption: "Congratulations are in order — another great delivery!", safe: true },
  { caption: "There is no better time to visit Bob Maxey Ford of Howell.", safe: true },
  { caption: "Thank you, Ford family!", safe: true },
  { caption: "Welcome to the Ford family! Big smiles today.", safe: true },
  { caption: "Built for Michigan roads.", safe: true },
  {
    caption: "Michelle's new Bronco is ready for the road.",
    customer: "Michelle",
    safe: true,
  },
];

describe("customer-identity guard parity (browser vs pb_hooks)", () => {
  it.each(corpus)("agrees on: $caption", ({ caption, customer, vehicle, safe }) => {
    const client = clientVerdict(caption, customer, vehicle);
    const server = serverVerdict(caption, customer, vehicle);
    expect({ client, server }).toEqual({ client: safe, server: safe });
  });
});
