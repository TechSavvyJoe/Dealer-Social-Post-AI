import React from "react";

/** Original DS monogram. Geometry matches the versioned v6 app artwork. */
export const Logo: React.FC<{
  className?: string;
  markOnly?: boolean;
  size?: number;
  tone?: "default" | "onBrand";
}> = ({ className, markOnly = false, size = 40, tone = "default" }) => {
  const onBrand = tone === "onBrand";
  return (
    <span role="img" aria-label="Dealer Social Post AI" className={className}>
      <svg
        viewBox="0 0 1024 1024"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect
          width="1024"
          height="1024"
          rx="224"
          fill={onBrand ? "var(--fill-hover)" : "rgb(var(--product-mark-background))"}
        />
        <g transform="translate(144.41 288) scale(2.095)">
          <path
            fill={
              onBrand
                ? "var(--brand-foreground)"
                : "rgb(var(--product-mark-foreground))"
            }
            d="M0 0H100C124 0 145 8 162 31L222 119H168L121 55C113 46 107 46 95 46H46V169H95C124 169 146 149 153 120L169 141C194 174 170 214 103 214H0Z"
          />
          <path
            fill={
              onBrand ? "var(--brand-foreground)" : "rgb(var(--product-mark-accent))"
            }
            d="M174 31C191 11 214 0 241 0H340V46H240C224 46 216 53 216 63C216 73 224 79 241 79H283C323 79 351 106 351 146C351 185 321 214 281 214H166L185 192C195 180 198 171 199 167H273C287 167 295 157 295 146C295 133 285 123 270 123H243Z"
          />
        </g>
      </svg>
      {!markOnly && (
        <span
          aria-hidden="true"
          className={`font-display text-xl font-bold tracking-[-0.02em] whitespace-nowrap ${onBrand ? "text-brand-foreground" : "text-ink"}`}
        >
          Dealer Social
        </span>
      )}
    </span>
  );
};
