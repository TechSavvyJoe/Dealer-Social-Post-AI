import React from "react";
import { ArrowLeft } from "lucide-react";
import type { GeneratedPost, ImageSelection } from "../types";
import { Button } from "./ui/Button";
import { ContentWorkspace } from "./workspace/ContentWorkspace";

export interface MyWorkProps {
  onBack: () => void;
  headerHasNavigation?: boolean;
  onOpenPost: (post: GeneratedPost) => void;
  onReusePhoto: (selection: ImageSelection) => void;
  onCreateContent?: () => void;
  onOpenSpins?: () => void;
  onOpenWalkarounds?: () => void;
}

export const MyWork: React.FC<MyWorkProps> = ({
  onBack,
  headerHasNavigation = false,
  ...workspace
}) => (
  <>
    {!headerHasNavigation && (
      <div className="cw-back">
        <Button variant="ghost" onClick={onBack} leftIcon={<ArrowLeft />}>
          Back
        </Button>
      </div>
    )}
    <ContentWorkspace mode="personal" {...workspace} />
  </>
);
