import React from "react";
import { Input } from "../ui/Input";
import type { Dealer } from "../../types";
import { dealerSetupStatus, joinWords } from "../../utils/dealerSetupStatus";
import { dealershipMentionFor } from "../../utils/socialAttribution";
import { ChannelRow, WhereToFind } from "./ChannelRow";
import { ConnectedServices } from "./ConnectedServices";
import { FieldRow } from "./SettingsRows";
import type { DealerSettingsForm } from "./useDealerSettingsForm";

export type ChannelKey = "facebook" | "instagram" | "optional";

const OPTIONAL_TITLE = "Google Business Profile, TikTok, X and LinkedIn";

/**
 * Which channel rows start open: the first counted channel that is not ready
 * on the SAVED record. The optional row is never "not ready", so it never
 * opens by itself. Read once; after that the manager opens and closes rows,
 * so a row with unsaved edits never closes on its own.
 */
export const initialOpenChannels = (dealer: Dealer): Record<ChannelKey, boolean> => {
  const rows = dealerSetupStatus(dealer).rows;
  const firstMissing = (["facebook", "instagram"] as const).find(
    (id) => rows.find((row) => row.id === id)?.state !== "ready",
  );
  return {
    facebook: firstMissing === "facebook",
    instagram: firstMissing === "instagram",
    optional: false,
  };
};

interface ChannelsSectionProps {
  form: DealerSettingsForm;
  /** The SAVED record: every row's status follows it, not unsaved typing. */
  dealer: Dealer;
  open: Record<ChannelKey, boolean>;
  onToggle: (channel: ChannelKey) => void;
}

export const ChannelsSection: React.FC<ChannelsSectionProps> = ({
  form,
  dealer,
  open,
  onToggle,
}) => {
  const { values } = form;
  const rows = dealerSetupStatus(dealer).rows;
  const row = (id: string) => rows.find((entry) => entry.id === id);
  const facebook = row("facebook");
  const instagram = row("instagram");
  const optionalSaved = rows.filter(
    (entry) =>
      ["gbp", "tiktok", "x", "linkedin"].includes(entry.id) && entry.state === "ready",
  );

  const facebookReady = facebook?.state === "ready";
  const instagramReady = instagram?.state === "ready";

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <div className="flex min-w-0 flex-col border-t border-hairline">
        <ChannelRow
          title="Facebook"
          status={facebookReady ? "ready" : "missing"}
          summary={
            facebookReady
              ? dealershipMentionFor("facebook_feed", dealer)
              : `Missing. ${facebook?.reason || ""}`.trim()
          }
          open={open.facebook}
          onToggle={() => onToggle("facebook")}
        >
          <FieldRow label="Page address" bare>
            {(a11y) => (
              <Input
                {...a11y}
                value={values.facebookUrl}
                onChange={(e) => form.setFacebookUrl(e.target.value)}
                placeholder="https://www.facebook.com/yourdealership"
                inputMode="url"
                fullWidth
              />
            )}
          </FieldRow>
          <FieldRow
            label="Page tag for captions"
            helper="Added to Facebook and Marketplace captions. Facebook may ask the salesperson to tap the Page suggestion once."
            bare
          >
            {(a11y) => (
              <Input
                {...a11y}
                value={values.facebookPageTag}
                onChange={(e) => form.setFacebookPageTag(e.target.value)}
                placeholder="@Your Dealership"
                fullWidth
              />
            )}
          </FieldRow>
          <WhereToFind
            title="Where to find these"
            steps={[
              "Open your store's Facebook Page in a browser.",
              "Copy the address from the top of the window into Page address.",
              "For the tag, type @ and your Page's name, or @ and the name after facebook.com/.",
            ]}
          />
        </ChannelRow>

        <ChannelRow
          title="Instagram"
          status={instagramReady ? "ready" : "missing"}
          summary={
            instagramReady
              ? dealershipMentionFor("instagram_feed", dealer)
              : `Missing. ${instagram?.reason || ""}`.trim()
          }
          open={open.instagram}
          onToggle={() => onToggle("instagram")}
        >
          <FieldRow
            label="Instagram handle"
            helper="Added to Instagram captions so they tag the store."
            bare
          >
            {(a11y) => (
              <Input
                {...a11y}
                value={values.instagramHandle}
                onChange={(e) => form.setInstagramHandle(e.target.value)}
                placeholder="@yourdealership"
                fullWidth
              />
            )}
          </FieldRow>
          <WhereToFind
            title="Where to find it"
            steps={[
              "Open your store's Instagram profile.",
              "The handle is the @name at the top.",
            ]}
          />
        </ChannelRow>

        <ChannelRow
          title={OPTIONAL_TITLE}
          status="optional"
          action={optionalSaved.length > 0 ? "Edit" : "Add"}
          summary={
            optionalSaved.length > 0
              ? `Saved: ${joinWords(
                  optionalSaved.map((entry) =>
                    `${entry.label} ${entry.value[0] || ""}`.trim(),
                  ),
                )}.`
              : "Optional. Add them only if your store uses them."
          }
          open={open.optional}
          onToggle={() => onToggle("optional")}
        >
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-x-4">
            <FieldRow
              label="Google Business Profile link"
              bare
              className="sm:col-span-2"
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  value={values.gbpUrl}
                  onChange={(e) => form.setGbpUrl(e.target.value)}
                  placeholder="https://g.page/yourdealership"
                  inputMode="url"
                  fullWidth
                />
              )}
            </FieldRow>
            <FieldRow label="TikTok handle" bare>
              {(a11y) => (
                <Input
                  {...a11y}
                  value={values.tiktokHandle}
                  onChange={(e) => form.setTiktokHandle(e.target.value)}
                  placeholder="@yourdealership"
                  fullWidth
                />
              )}
            </FieldRow>
            <FieldRow label="X handle" bare>
              {(a11y) => (
                <Input
                  {...a11y}
                  value={values.xHandle}
                  onChange={(e) => form.setXHandle(e.target.value)}
                  placeholder="@yourdealership"
                  fullWidth
                />
              )}
            </FieldRow>
            <FieldRow
              label="LinkedIn company tag"
              helper="LinkedIn may ask the salesperson to choose the company suggestion."
              bare
              className="sm:col-span-2"
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  value={values.linkedinCompanyTag}
                  onChange={(e) => form.setLinkedinCompanyTag(e.target.value)}
                  placeholder="@your-company"
                  fullWidth
                />
              )}
            </FieldRow>
          </div>
        </ChannelRow>
      </div>

      <ConnectedServices />
    </div>
  );
};
