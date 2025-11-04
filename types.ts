export enum AppStep {
  WELCOME,
  CAPTURE,
  CUSTOMIZE,
  GENERATING,
  RESULT,
}

export enum StyleOption {
  Luxury = "Luxury & Elegance",
  Modern = "Modern & Bold",
  Friendly = "Fun & Friendly",
  Sporty = "Sporty & Dynamic",
}

export enum ToneOption {
  Excited = "Excited",
  Professional = "Professional",
  Family = "Family-Friendly",
}


export interface GeneratedPost {
  image: string; // base64 data URL
  text: string;
}

export interface DealershipSettings {
  dealershipName: string;
  dealershipLogo?: string; // base64 data URL
}