import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { vi } from 'vitest';
import { PostCustomizer } from '../components/PostCustomizer';
import { StyleOption, ToneOption } from '../types';

Object.assign(global.navigator, { vibrate: vi.fn() });

describe('PostCustomizer', () => {
  const baseProps = {
    imageSrc: 'data:image/png;base64,xyz',
    dealershipName: 'Test Motors',
    onBack: vi.fn(),
    onGenerate: vi.fn(),
    onStyleToneChange: vi.fn(),
    isApiKeyConfigured: true,
    onOpenSettings: vi.fn(),
    defaultStyle: StyleOption.Modern,
    defaultTone: ToneOption.Excited,
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('invokes onStyleToneChange when selecting a new style', () => {
    render(<PostCustomizer {...baseProps} />);

    const sportyCard = screen.getByText(StyleOption.Sporty);
    fireEvent.click(sportyCard);

    expect(baseProps.onStyleToneChange).toHaveBeenCalledWith(StyleOption.Sporty, ToneOption.Excited);
  });

  it('disables generate button when API key is not configured', () => {
    render(<PostCustomizer {...baseProps} isApiKeyConfigured={false} />);

    const button = screen.getByRole('button', { name: /add api key to generate/i });
    expect(button).toBeDisabled();
  });
});
