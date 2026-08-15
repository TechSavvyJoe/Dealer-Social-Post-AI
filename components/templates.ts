import { TemplateOption } from "../types";
import { formatHashtag } from "../utils/hashtags";

interface TemplateIdentity {
  customerName?: string;
  dealershipName: string;
}

const fallbackCustomer = "our amazing customer";

/**
 * Resolve a saved template from the current form identity at the last possible
 * moment. Keeping placeholders in the source template prevents a caption from
 * retaining the previous customer when the form or signed release changes.
 */
export const renderPostTemplate = (
  content: string,
  { customerName, dealershipName }: TemplateIdentity,
): string =>
  content
    .replace(/#\[Dealership Name\]/g, formatHashtag(dealershipName))
    .replace(/\[Customer Name\]/g, customerName?.trim() || fallbackCustomer)
    .replace(/\[Dealership Name\]/g, dealershipName.trim());

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Keep manually edited copy tied to the live customer field without touching
 * partial words (for example, changing "Ann" must not alter "announcement").
 */
export const replaceCustomerIdentity = (
  caption: string,
  previousCustomerName: string,
  nextCustomerName: string,
): string => {
  const previous = previousCustomerName.trim();
  if (!previous) return caption;

  const next = nextCustomerName.trim() || fallbackCustomer;
  const exactIdentity = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(previous)}(?=$|[^\\p{L}\\p{N}])`,
    "giu",
  );
  return caption.replace(exactIdentity, (_match, prefix: string) => `${prefix}${next}`);
};

export const POST_TEMPLATES: TemplateOption[] = [
  {
    id: "t1",
    name: "Classic Congrats",
    content:
      "Congratulations to [Customer Name] on their incredible new ride! We're so happy we could help. Welcome to the [Dealership Name] family!\n\n#[Dealership Name] #NewCar #HappyCustomer",
  },
  {
    id: "t2",
    name: "High Energy",
    content:
      "And just like that, another dream hits the road! 🔥 Huge congrats to [Customer Name] on scoring this absolute beauty. Where's the first road trip?\n\n#NewCarVibes #CarGoals #[Dealership Name] #Upgraded",
  },
  {
    id: "t3",
    name: "Family Welcome",
    content:
      "It's more than a car, it's a new chapter for the whole family! We were so thrilled to hand over the keys to [Customer Name]. Wishing you many happy miles ahead!\n\n#[Dealership Name] #FamilyCar #NewBeginnings #HappyCustomer",
  },
  {
    id: "t4",
    name: "Short & Sweet",
    content:
      "From our showroom to their driveway. Congratulations, [Customer Name]! Enjoy the new wheels.\n\n#[Dealership Name] #NewCarDay #Sold",
  },
  {
    id: "t5",
    name: "Luxury Vibe",
    content:
      "The definition of driving in style. A huge congratulations to [Customer Name] on acquiring this masterpiece. Welcome to an exclusive club. Welcome to the [Dealership Name] family.\n\n#LuxuryCars #DreamCar #[Dealership Name] #Excellence",
  },
  {
    id: "t6",
    name: "Adventure Awaits",
    content:
      "Ready for any adventure! We're so excited for [Customer Name] as they get ready to hit the trails and open roads in their new beast. Let the adventures begin!\n\n#AdventureReady #Offroad #SUVLife #[Dealership Name]",
  },
  {
    id: "t7",
    name: "Future is Here (EV)",
    content:
      "Driving into the future! ⚡️ A massive congratulations to [Customer Name] on going electric with this stunning new ride. Quiet roads and zero emissions ahead!\n\n#EV #ElectricCar #GoElectric #[Dealership Name] #SustainableDriving",
  },
  {
    id: "t8",
    name: "First Car Feeling",
    content:
      "There's nothing like that first set of keys! We're honored to be a part of this huge milestone for [Customer Name]. Drive safe and enjoy the freedom!\n\n#FirstCar #NewDriver #Milestone #[Dealership Name] #Freedom",
  },
  {
    id: "t9",
    name: "Power & Performance",
    content:
      "Unleash the power! A massive shoutout to [Customer Name] for choosing this absolute performance monster. We know you'll be turning heads everywhere you go.\n\n#PerformanceCars #Horsepower #CarEnthusiast #[Dealership Name] #Speed",
  },
  {
    id: "t10",
    name: "Just for Laughs",
    content:
      "Traded in their old ride for this beauty and an extra cup holder. We'd say that's a win! Congrats on the upgrade, [Customer Name]! #Adulting\n\n#[Dealership Name] #CarUpgrade #Funny #Finally",
  },
];
