import React from "react";
import { Textarea } from "../ui/Input";
import { PhraseChipEditor } from "./PhraseChipEditor";
import { FieldRow, SettingsGroup, SwitchRow } from "./SettingsRows";
import type { DealerSettingsForm } from "./useDealerSettingsForm";

/** Voice: how captions sound, and what every caption carries. */
export const VoiceSection: React.FC<{ form: DealerSettingsForm }> = ({ form }) => {
  const { values } = form;
  return (
    <div className="flex min-w-0 flex-col gap-10">
      <SettingsGroup title="Brand voice">
        <FieldRow label="How captions should sound">
          {(a11y) => (
            <Textarea
              {...a11y}
              value={values.voice}
              onChange={(e) => form.setVoice(e.target.value)}
              rows={4}
              fullWidth
              placeholder={`e.g. "Confident, no exclamation points, never 'family-owned'. Local Detroit references are good."`}
            />
          )}
        </FieldRow>
        {/*
          Both columns sit side by side from sm, so the placeholder has to fit
          its own field and the two helper lines have to wrap the same way;
          otherwise the columns end at different heights.
        */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 border-t border-hairline py-4 sm:grid-cols-2">
          <PhraseChipEditor
            label="Do"
            helperText="Up to 3 phrases captions always use."
            placeholder="Use first names"
            phrases={values.voiceDo}
            onChange={form.setVoiceDo}
          />
          <PhraseChipEditor
            label="Don't"
            helperText="Up to 3 phrases captions never use."
            placeholder="No exclamation points"
            phrases={values.voiceDont}
            onChange={form.setVoiceDont}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title="On every post">
        <FieldRow label="Default hashtags, one per line">
          {(a11y) => (
            <Textarea
              {...a11y}
              value={values.defaultHashtags}
              onChange={(e) => form.setDefaultHashtags(e.target.value)}
              rows={3}
              fullWidth
              placeholder={"#YourDealership\n#DetroitFord\n#NewRide"}
            />
          )}
        </FieldRow>
        <SwitchRow
          label="Always include every hashtag above"
          helper="Keeps these tags on every post no matter the platform cap. Discovery hashtags only fill the remaining slots."
          checked={values.hashtagsLocked}
          onChange={form.setHashtagsLocked}
        />
        <FieldRow label="Footer">
          {(a11y) => (
            <Textarea
              {...a11y}
              value={values.defaultFooter}
              onChange={(e) => form.setDefaultFooter(e.target.value)}
              rows={2}
              fullWidth
              placeholder="Stop by 123 Main St, open until 9pm. Call us at (313) 555-0100."
            />
          )}
        </FieldRow>
      </SettingsGroup>

      <SettingsGroup title="Banned phrases">
        <FieldRow label="Phrases captions must never use, one per line">
          {(a11y) => (
            <Textarea
              {...a11y}
              value={values.banned}
              onChange={(e) => form.setBanned(e.target.value)}
              rows={4}
              fullWidth
              placeholder={`guaranteed approval\nno credit check\nlowest price guaranteed`}
            />
          )}
        </FieldRow>
      </SettingsGroup>
    </div>
  );
};
