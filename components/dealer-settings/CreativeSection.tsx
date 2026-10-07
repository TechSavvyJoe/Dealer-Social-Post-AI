import React, { useId, useRef } from "react";
import { Input, Select } from "../ui/Input";
import { CustomScenarioManager } from "../CustomScenarioManager";
import { featuredFunStyleCatalog } from "../../services/promptConfig";
import { isCreativeSystemEnabled } from "../../services/creativeSystem";
import {
  StyleOption,
  type Dealer,
  type ImageQualityTier,
  type SignatureLook,
} from "../../types";
import { cn } from "../../utils/classNames";
import {
  aspectRatios as motionAspectOptions,
  soundtracks as motionAudioOptions,
  styles as motionStyleOptions,
} from "../video-director/constants";
import { LogoField, logoSizeHelp } from "./LogoField";
import { SamplePhoto } from "./SamplePhoto";
import {
  HEX_RE,
  LOGO_SCALE_DEFAULT,
  LOGO_SCALE_MAX,
  LOGO_SCALE_MIN,
  SIGNATURE_LOOK_OPTIONS,
  isMotionAspect,
  isMotionAudio,
} from "./settingsModel";
import {
  Chip,
  DisclosureRow,
  ROW_HELPER,
  SettingRow,
  SettingsGroup,
  SettingsSubgroup,
} from "./SettingsRows";
import type { DealerSettingsForm, SettingsSave } from "./useDealerSettingsForm";

/** The picker needs a value even when no color is saved yet. */
const PICKER_FALLBACK = "#1d4ed8";

/**
 * What the system administrator's creative-system switch still changes, in two
 * sentences. Team feature access, channels by post type, the playful style
 * and the motion apply to every store (services/storeDefaults.ts); the switch
 * decides whether posts use the signature Look (its photo treatment and caption
 * tone, and the second Look on the Post screen) or the classic image styles
 * (services/creativeSystem.ts resolveCreative).
 */
export const creativeStatusSentence = (dealer: Dealer): string =>
  isCreativeSystemEnabled(dealer)
    ? "Your store uses the signature Look: new posts get its photo treatment and caption tone, and the classic image styles no longer apply. Only a system administrator can turn it off."
    : "Your store's posts still use the classic image styles, so the Look you choose here is saved but not used yet. A system administrator turns on the signature Look for your store; a manager cannot.";

interface CreativeSectionProps {
  form: DealerSettingsForm;
  /** The saved record: the switch, the saved logo and custom post types. */
  dealer: Dealer;
  onSaved: SettingsSave;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
}

export const CreativeSection: React.FC<CreativeSectionProps> = ({
  form,
  dealer,
  onSaved,
  advancedOpen,
  onToggleAdvanced,
}) => {
  const { values, draft } = form;
  const lookOn = isCreativeSystemEnabled(dealer);
  // The session record: a logo uploaded here is merged into it at once.
  const hasLogo = Boolean(dealer.logo);
  const lookHeadingId = useId();
  const secondLookName = useId();
  const imageQualityName = useId();
  const advancedId = useId();
  const lookRefs = useRef<Record<SignatureLook, HTMLButtonElement | null>>({
    showroom: null,
    hometown: null,
    turbo: null,
  });

  const moveLook = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))
      return;
    event.preventDefault();
    const ids = SIGNATURE_LOOK_OPTIONS.map((option) => option.id);
    const current = Math.max(0, ids.indexOf(values.signatureLook as SignatureLook));
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = ids[(current + delta + ids.length) % ids.length];
    form.selectLook(next);
    requestAnimationFrame(() => lookRefs.current[next]?.focus());
  };

  const motionDisabled = !form.motionStyle;
  const styleIds = Object.values(StyleOption);
  const enabledCount = styleIds.filter((style) =>
    form.enabledStyleSet.has(style),
  ).length;

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <SettingsGroup
        title="Signature Look"
        headingId={lookHeadingId}
        description={
          lookOn
            ? "Every new post starts in this Look. These previews are illustrations; each post is designed around its own photo."
            : "Once the signature Look is on for your store, every new post starts in this Look. These previews are illustrations; each post is designed around its own photo."
        }
      >
        <div
          role="radiogroup"
          aria-labelledby={lookHeadingId}
          onKeyDown={moveLook}
          className="grid grid-cols-1 gap-4 pt-1 sm:grid-cols-3"
        >
          {SIGNATURE_LOOK_OPTIONS.map((option, index) => {
            const selected = values.signatureLook === option.id;
            const focusable = selected || (!values.signatureLook && index === 0);
            const descriptionId = `${lookHeadingId}-${option.id}`;
            return (
              <button
                key={option.id}
                ref={(element) => {
                  lookRefs.current[option.id] = element;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={option.label}
                aria-describedby={descriptionId}
                tabIndex={focusable ? 0 : -1}
                onClick={() => form.selectLook(option.id)}
                className="flex min-w-0 items-start gap-3 rounded-sm text-left sm:flex-col"
              >
                <SamplePhoto
                  dealer={draft}
                  look={option.id}
                  decorative
                  className={cn(
                    "w-24 shrink-0 sm:w-full",
                    selected && "outline outline-2 outline-offset-2 outline-brand-ink",
                  )}
                />
                <span className="flex min-w-0 items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                      selected ? "border-brand-ink" : "border-strong",
                    )}
                  >
                    {selected ? (
                      <span className="h-2.5 w-2.5 rounded-full bg-brand-ink" />
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span
                      className={cn(
                        "text-base leading-[1.375rem] text-ink",
                        selected ? "font-semibold" : "font-medium",
                      )}
                    >
                      {option.label}
                    </span>
                    <span id={descriptionId} className={ROW_HELPER}>
                      {option.description}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <div className="flex min-w-0 flex-col">
        <SettingRow
          label="Second Look"
          helper={
            lookOn
              ? "Salespeople can switch a post to this one on the Post screen."
              : "Once the signature Look is on for your store, salespeople can switch a post to this one on the Post screen."
          }
        >
          {({ labelId, helperId }) => (
            <div
              role="radiogroup"
              aria-labelledby={labelId}
              aria-describedby={helperId}
              className="flex flex-wrap gap-2"
            >
              <Chip
                type="radio"
                name={secondLookName}
                value=""
                checked={values.alternateLook === ""}
                onChange={() => form.setAlternateLook("")}
              >
                None
              </Chip>
              {SIGNATURE_LOOK_OPTIONS.filter(
                (option) => option.id !== values.signatureLook,
              ).map((option) => (
                <Chip
                  key={option.id}
                  type="radio"
                  name={secondLookName}
                  value={option.id}
                  checked={values.alternateLook === option.id}
                  onChange={() => form.setAlternateLook(option.id)}
                >
                  {option.label}
                </Chip>
              ))}
            </div>
          )}
        </SettingRow>

        <SettingRow
          label="Playful style"
          labelFor
          helper="One fun treatment your team can try on a post. Turn it off for the whole team under Workflow."
        >
          {({ controlId, helperId }) => (
            <div className="w-full sm:w-[12.5rem]">
              <Select
                id={controlId}
                aria-describedby={helperId}
                value={values.playfulStyle}
                onChange={(event) => form.setPlayfulStyle(event.target.value)}
                fullWidth
              >
                <option value="">Not set</option>
                {featuredFunStyleCatalog.map((style) => (
                  <option key={style.id} value={style.id}>
                    {style.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </SettingRow>

        <SettingRow
          label="Store color"
          labelFor
          helper="The only accent in the app. Your team sees it on main buttons, like Save changes below."
        >
          {({ controlId, helperId }) => (
            <div className="flex w-full items-center gap-2.5 sm:w-[12.5rem]">
              <input
                type="color"
                value={HEX_RE.test(values.color) ? values.color : PICKER_FALLBACK}
                onChange={(e) => form.setColor(e.target.value)}
                aria-label="Pick store color"
                className="h-11 w-11 shrink-0 cursor-pointer rounded-sm border border-strong bg-transparent p-0.5"
              />
              <Input
                id={controlId}
                aria-describedby={helperId}
                value={values.color}
                onChange={(e) => form.setColor(e.target.value)}
                placeholder="#1d4ed8"
                fullWidth
              />
            </div>
          )}
        </SettingRow>

        <LogoField
          dealer={dealer}
          corner={form.logoCorner}
          onCornerChange={form.setLogoCorner}
          onClearPlacement={() => {
            form.setLogoCorner("");
            form.setLogoScale(LOGO_SCALE_DEFAULT);
          }}
        />

        <DisclosureRow
          title="Video and advanced"
          helper="Motion, logo size, image quality, classic styles and custom post types."
          open={advancedOpen}
          onToggle={onToggleAdvanced}
          controls={advancedId}
        />
        {/* The class hides it too: `flex` outranks the `[hidden]` preflight rule. */}
        <div
          id={advancedId}
          hidden={!advancedOpen}
          className={cn("flex-col gap-8 pt-6", advancedOpen ? "flex" : "hidden")}
        >
          <SettingsSubgroup title="Motion">
            <SettingRow
              label="Motion style"
              labelFor
              helper={
                form.suggestedMotionStyle
                  ? `Suggested for ${form.selectedLookOption?.label}: ${form.suggestedMotionStyle.label}`
                  : "Bound to every video the team adds."
              }
            >
              {({ controlId, helperId }) => (
                <div className="w-full sm:w-[12.5rem]">
                  <Select
                    id={controlId}
                    aria-describedby={helperId}
                    value={form.motionStyle}
                    onChange={(event) => form.setMotionStyle(event.target.value)}
                    fullWidth
                  >
                    <option value="">Not set</option>
                    {motionStyleOptions.map((option) => (
                      <option key={option.style} value={option.style}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </SettingRow>
            <SettingRow label="Aspects">
              {({ labelId }) => (
                <div
                  role="group"
                  aria-labelledby={labelId}
                  className="flex flex-wrap gap-2"
                >
                  {motionAspectOptions.map((option) => (
                    <Chip
                      key={option.value}
                      type="checkbox"
                      checked={
                        isMotionAspect(option.value) &&
                        form.motionAspects.includes(option.value)
                      }
                      disabled={motionDisabled}
                      onChange={() => {
                        if (isMotionAspect(option.value))
                          form.toggleMotionAspect(option.value);
                      }}
                    >
                      {option.label}
                    </Chip>
                  ))}
                </div>
              )}
            </SettingRow>
            <SettingRow label="Audio" labelFor>
              {({ controlId }) => (
                <div className="w-full sm:w-[12.5rem]">
                  <Select
                    id={controlId}
                    value={form.motionAudio}
                    disabled={motionDisabled}
                    onChange={(event) => {
                      if (isMotionAudio(event.target.value))
                        form.setMotionAudio(event.target.value);
                    }}
                    fullWidth
                  >
                    {motionAudioOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </SettingRow>
          </SettingsSubgroup>

          <SettingsSubgroup title="Logo and image">
            <SettingRow
              label="Logo size"
              labelFor
              helper={logoSizeHelp(hasLogo, form.logoCorner)}
            >
              {({ controlId, helperId }) => (
                <div className="flex w-full items-center gap-3 sm:w-[12.5rem]">
                  <input
                    id={controlId}
                    type="range"
                    aria-describedby={helperId}
                    min={Math.round(LOGO_SCALE_MIN * 100)}
                    max={Math.round(LOGO_SCALE_MAX * 100)}
                    step={1}
                    value={Math.round(form.logoScale * 100)}
                    disabled={!form.logoCorner}
                    onChange={(event) =>
                      form.setLogoScale(Number(event.target.value) / 100)
                    }
                    className="min-h-11 w-full accent-brand-ink disabled:opacity-50"
                  />
                  <output
                    htmlFor={controlId}
                    className="w-10 shrink-0 text-right text-sm tabular-nums text-ink"
                  >
                    {Math.round(form.logoScale * 100)}%
                  </output>
                </div>
              )}
            </SettingRow>
            <SettingRow
              label="Image quality"
              helper="Your choice applies to every new image your team creates. Studio asks for more detailed 4K images, which cost more per image."
            >
              {({ labelId, helperId }) => (
                <div
                  role="radiogroup"
                  aria-labelledby={labelId}
                  aria-describedby={helperId}
                  className="flex flex-wrap gap-2"
                >
                  {(
                    [
                      { id: "standard", label: "Standard" },
                      { id: "studio", label: "Studio" },
                    ] as Array<{ id: ImageQualityTier; label: string }>
                  ).map((option) => (
                    <Chip
                      key={option.id}
                      type="radio"
                      name={imageQualityName}
                      value={option.id}
                      checked={values.imageQualityTier === option.id}
                      onChange={() => form.setImageQualityTier(option.id)}
                    >
                      {option.label}
                    </Chip>
                  ))}
                </div>
              )}
            </SettingRow>
          </SettingsSubgroup>

          <SettingsSubgroup
            title="Classic image styles"
            description={
              lookOn
                ? "Your store uses the signature Look, so new posts do not use these styles."
                : "New posts use the default style when it is on. With no default, or one that is off, they use Modern & Bold if it is on, otherwise the first style in this list that is on. The Post screen offers up to three of the styles that are on."
            }
          >
            <SettingRow label="Styles that are on">
              {({ labelId }) => (
                <div
                  role="group"
                  aria-labelledby={labelId}
                  className="flex flex-wrap gap-2"
                >
                  {styleIds.map((style) => {
                    const on = form.enabledStyleSet.has(style);
                    return (
                      <Chip
                        key={style}
                        type="checkbox"
                        checked={on}
                        // At least one style stays on.
                        disabled={on && enabledCount === 1}
                        onChange={() => form.toggleStyle(style)}
                      >
                        {style}
                      </Chip>
                    );
                  })}
                </div>
              )}
            </SettingRow>
            <SettingRow label="Default classic style" labelFor>
              {({ controlId }) => (
                <div className="w-full sm:w-[12.5rem]">
                  <Select
                    id={controlId}
                    value={values.defaultStyle}
                    onChange={(event) => form.setDefaultStyle(event.target.value)}
                    fullWidth
                  >
                    <option value="">No default</option>
                    {styleIds
                      // A saved default that is no longer on still shows as
                      // itself rather than as "No default", marked off:
                      // new posts skip it (services/storeDefaults.ts
                      // legacyRenderedStyle).
                      .filter(
                        (style) =>
                          form.enabledStyleSet.has(style) ||
                          style === values.defaultStyle,
                      )
                      .map((style) => (
                        <option key={style} value={style}>
                          {form.enabledStyleSet.has(style) ? style : `${style} (off)`}
                        </option>
                      ))}
                  </Select>
                </div>
              )}
            </SettingRow>
          </SettingsSubgroup>

          <div className="border-t border-hairline pt-4">
            <CustomScenarioManager
              customScenariosJson={dealer.custom_scenarios}
              onSave={async (json) => {
                await onSaved({ custom_scenarios: json });
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
