import { describe, expect, it } from 'vitest';
import { analyzeOfferingInputCompatibility } from '../../src/integrations/virtuals/offering-input-compatibility.js';

const providerInput = {
  topic: 'AI agent payments on Base',
  timeframe: '24h',
  focus: 'analysis',
};

describe('offering input compatibility', () => {
  it('accepts provider input that satisfies the published schema', () => {
    expect(
      analyzeOfferingInputCompatibility(
        {
          type: 'object',
          required: ['topic'],
          properties: {
            topic: { type: 'string', minLength: 2 },
            timeframe: { type: 'string', enum: ['24h', '7d'] },
            focus: { type: 'string', enum: ['breaking', 'analysis', 'risk', 'general'] },
          },
          additionalProperties: false,
        },
        providerInput,
      ),
    ).toMatchObject({ compatible: true, validated: true });
  });

  it('rejects provider input missing fields required by the offering', () => {
    const result = analyzeOfferingInputCompatibility(
      {
        type: 'object',
        required: [
          'primary_search_term',
          'raw_full_user_request',
          'initiate_filtered_news_job',
          'please_confirm_topic_is_2_words_or_less',
        ],
        properties: {
          primary_search_term: { type: 'string' },
          raw_full_user_request: { type: 'string' },
          initiate_filtered_news_job: { type: 'boolean' },
          please_confirm_topic_is_2_words_or_less: { type: 'boolean' },
        },
      },
      providerInput,
    );

    expect(result).toMatchObject({ compatible: false, validated: true });
    expect(result.reasons).toContain('$.primary_search_term is required by the offering');
  });

  it('does not claim validation for legacy requirements that are not JSON Schema', () => {
    expect(
      analyzeOfferingInputCompatibility(
        '{"period":"daily|weekly","format":"md|json"}',
        providerInput,
      ),
    ).toMatchObject({ compatible: true, validated: false });
  });
});
