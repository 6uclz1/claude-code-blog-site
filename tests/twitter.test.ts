import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  authorLabel,
  canonicalTweetUrl,
  fetchTweet,
  fetchTweetViaFxTwitter,
  fetchTweetViaOEmbed,
  fxTwitterUrl,
  fetchTweetViaSyndication,
  parseOEmbedHtml,
  parseTweetRef,
  syndicationToken,
  tweetText,
  tweetTitle,
  type Tweet,
} from '../scripts/lib/sources/twitter.ts';
import { okResponse } from './helpers.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('parseTweetRef', () => {
  it('ポストのURLからIDとアカウントを取り出す', () => {
    expect(parseTweetRef('https://x.com/claudeai/status/2079595988998554047?s=20')).toEqual({
      id: '2079595988998554047',
      handle: 'claudeai',
    });
    expect(parseTweetRef('https://twitter.com/user/statuses/123')).toEqual({
      id: '123',
      handle: 'user',
    });
    expect(parseTweetRef('https://mobile.twitter.com/user/status/123')).toEqual({
      id: '123',
      handle: 'user',
    });
  });

  it('アカウントが分からない形式でもIDは取れる', () => {
    expect(parseTweetRef('https://x.com/i/web/status/123')).toEqual({ id: '123' });
  });

  it('ポスト単体でないURLは undefined', () => {
    // プロフィールやトレンドには要約する本文が無い
    for (const url of [
      'https://x.com/peing_tech',
      'https://x.com/i/trending/2059406543393636372',
      'https://example.com/user/status/123',
      'not a url',
    ]) {
      expect(parseTweetRef(url), url).toBeUndefined();
    }
  });
});

describe('canonicalTweetUrl', () => {
  it('余計なクエリを落としたURLにする', () => {
    expect(canonicalTweetUrl({ id: '123', handle: 'user' })).toBe(
      'https://twitter.com/user/status/123'
    );
    expect(canonicalTweetUrl({ id: '123' })).toBe('https://twitter.com/i/web/status/123');
  });
});

const OEMBED_HTML =
  '<blockquote class="twitter-tweet"><p lang="ja" dir="ltr">Cowork にスキル学習が来ました</p>' +
  '&mdash; Claude (@claudeai) <a href="https://twitter.com/claudeai/status/123">July 22, 2026</a>' +
  '</blockquote>';

describe('parseOEmbedHtml', () => {
  it('埋め込みHTMLから本文とアカウントを取り出す', () => {
    expect(parseOEmbedHtml(OEMBED_HTML)).toEqual({
      text: 'Cowork にスキル学習が来ました',
      handle: 'claudeai',
    });
  });
});

describe('fetchTweetViaOEmbed', () => {
  it('公式のoEmbedから本文を取る', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse(
          JSON.stringify({ html: OEMBED_HTML, author_name: 'Claude' }),
          'application/json'
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchTweetViaOEmbed({ id: '123', handle: 'claudeai' })).toEqual({
      id: '123',
      name: 'Claude',
      handle: 'claudeai',
      text: 'Cowork にスキル学習が来ました',
    });
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      'url=https%3A%2F%2Ftwitter.com%2Fclaudeai%2Fstatus%2F123'
    );
  });

  it('本文が無ければ undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('{}', 'application/json')));

    expect(await fetchTweetViaOEmbed({ id: '123', handle: 'u' })).toBeUndefined();
  });
});

describe('syndicationToken', () => {
  it('IDから決まる値を返す（認証情報ではない）', () => {
    expect(syndicationToken('123')).toBe(syndicationToken('123'));
    expect(syndicationToken('123')).not.toBe(syndicationToken('124'));
    expect(syndicationToken('2079595988998554047')).toMatch(/^[0-9a-z]+$/);
  });
});

describe('fetchTweetViaSyndication', () => {
  it('本文・作者・引用元を取る', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse(
          JSON.stringify({
            text: 'ポスト本文',
            user: { name: '表示名', screen_name: 'handle' },
            quoted_tweet: { text: '引用元の本文', user: { screen_name: 'quoted' } },
          }),
          'application/json'
        )
      )
    );

    expect(await fetchTweetViaSyndication({ id: '123' })).toEqual({
      id: '123',
      name: '表示名',
      handle: 'handle',
      text: 'ポスト本文',
      quoted: { text: '引用元の本文', handle: 'quoted' },
    });
  });

  it('削除済みなど本文が無ければ undefined', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse('{"__typename":"TweetTombstone"}', 'application/json'))
    );

    expect(await fetchTweetViaSyndication({ id: '123' })).toBeUndefined();
  });
});

describe('fetchTweet', () => {
  const tweet: Tweet = { id: '1', text: '本文', handle: 'user' };
  const none = () => vi.fn().mockResolvedValue(undefined);

  it('FxTwitter を最初に試す', async () => {
    const fetchers = {
      fxTwitter: vi.fn().mockResolvedValue(tweet),
      oEmbed: vi.fn().mockResolvedValue(tweet),
      syndication: vi.fn().mockResolvedValue(tweet),
    };

    expect(await fetchTweet({ id: '1', handle: 'user' }, fetchers)).toBe(tweet);
    expect(fetchers.oEmbed).not.toHaveBeenCalled();
    expect(fetchers.syndication).not.toHaveBeenCalled();
  });

  it('FxTwitter が取れずアカウントが分かるときは公式のoEmbedを次に試す', async () => {
    const fetchers = {
      fxTwitter: none(),
      oEmbed: vi.fn().mockResolvedValue(tweet),
      syndication: vi.fn().mockResolvedValue(tweet),
    };

    expect(await fetchTweet({ id: '1', handle: 'user' }, fetchers)).toBe(tweet);
    expect(fetchers.syndication).not.toHaveBeenCalled();
  });

  it('アカウントが分からないときは oEmbed より syndication を先に試す', async () => {
    // oEmbed は /i/web/status/ 形式のURLを受け付けない
    const fetchers = {
      fxTwitter: none(),
      oEmbed: vi.fn().mockResolvedValue(tweet),
      syndication: vi.fn().mockResolvedValue(tweet),
    };

    await fetchTweet({ id: '1' }, fetchers);

    expect(fetchers.syndication).toHaveBeenCalled();
    expect(fetchers.oEmbed).not.toHaveBeenCalled();
  });

  it('先の経路が失敗したら次に落とす', async () => {
    const fetchers = {
      fxTwitter: vi.fn().mockRejectedValue(new Error('HTTP 503')),
      oEmbed: vi.fn().mockRejectedValue(new Error('HTTP 404')),
      syndication: vi.fn().mockResolvedValue(tweet),
    };

    expect(await fetchTweet({ id: '1', handle: 'user' }, fetchers)).toBe(tweet);
  });

  it('どれも取れなければ undefined', async () => {
    const fetchers = { fxTwitter: none(), oEmbed: none(), syndication: none() };

    expect(await fetchTweet({ id: '1', handle: 'user' }, fetchers)).toBeUndefined();
  });
});

describe('fetchTweetViaFxTwitter', () => {
  const stubJson = (payload: unknown) => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(JSON.stringify(payload), 'application/json'));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('アカウントが分からなくても叩けるURLにする', () => {
    expect(fxTwitterUrl({ id: '123', handle: 'user' })).toBe(
      'https://api.fxtwitter.com/user/status/123'
    );
    expect(fxTwitterUrl({ id: '123' })).toBe('https://api.fxtwitter.com/i/status/123');
  });

  it('本文・作者・引用元・画像の代替テキスト・投票を取る', async () => {
    const fetchMock = stubJson({
      code: 200,
      message: 'OK',
      tweet: {
        text: '新しいリリースです',
        author: { name: 'Claude', screen_name: 'claudeai' },
        quote: { text: '引用元の本文', author: { name: '元', screen_name: 'orig' } },
        media: { photos: [{ altText: 'ベンチマークのグラフ' }, { altText: '' }] },
        poll: { choices: [{ label: '使う' }, { label: '使わない' }] },
      },
    });

    const tweet = await fetchTweetViaFxTwitter({ id: '123', handle: 'claudeai' });

    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.fxtwitter.com/claudeai/status/123');
    expect(tweet).toEqual({
      id: '123',
      text: '新しいリリースです',
      name: 'Claude',
      handle: 'claudeai',
      quoted: { text: '引用元の本文', name: '元', handle: 'orig' },
      extras: ['画像: ベンチマークのグラフ', '投票: 使う / 使わない'],
    });
  });

  it('本文がリンクだけの X の記事(Articles)でも中身を取る', async () => {
    // oEmbed / syndication では本文が URL だけになり、要約が「投稿が紹介された」で終わっていた
    stubJson({
      code: 200,
      tweet: {
        text: 'https://t.co/abc',
        author: { name: 'Kensei', screen_name: '0xKense1' },
        article: {
          title: 'エージェント設計の5原則',
          preview_text: 'プレビュー',
          content: { blocks: [{ text: '第一段落' }, { text: '' }, { text: '第二段落' }] },
        },
      },
    });

    const tweet = await fetchTweetViaFxTwitter({ id: '9', handle: '0xKense1' });

    expect(tweet?.article).toEqual({ title: 'エージェント設計の5原則', text: '第一段落\n第二段落' });
    expect(tweetTitle(tweet!)).toBe('Kensei(@0xKense1) の記事: エージェント設計の5原則');
    expect(tweetText(tweet!)).toContain('第二段落');
  });

  it('記事の本文ブロックが無ければプレビューを使う', async () => {
    stubJson({ code: 200, tweet: { text: '', article: { preview_text: 'プレビュー本文' } } });

    const tweet = await fetchTweetViaFxTwitter({ id: '9' });

    expect(tweet?.article).toEqual({ text: 'プレビュー本文' });
  });

  it('本文も記事も無ければ undefined', async () => {
    stubJson({ code: 404, message: 'NOT_FOUND' });
    expect(await fetchTweetViaFxTwitter({ id: '1' })).toBeUndefined();

    stubJson({ code: 200, tweet: { text: '  ' } });
    expect(await fetchTweetViaFxTwitter({ id: '1' })).toBeUndefined();
  });
});

describe('tweetTitle / tweetText', () => {
  it('はてなのRSSがURLしか返さないポスト用の見出しを作る', () => {
    const title = tweetTitle({ id: '1', name: 'Claude', handle: 'claudeai', text: 'スキル学習が来ました' });

    expect(title).toBe('Claude(@claudeai) のポスト: スキル学習が来ました');
  });

  it('長い本文は見出し用に切り詰める', () => {
    const title = tweetTitle({ id: '1', handle: 'u', text: 'あ'.repeat(200) });

    expect(title.length).toBeLessThan(70);
    expect(title.endsWith('…')).toBe(true);
  });

  it('本文がURLだけなら本文抜きの見出しにする', () => {
    expect(tweetTitle({ id: '1', handle: 'u', text: 'https://example.com/' })).toBe(
      '@u のポスト'
    );
  });

  it('要約に渡す本文には作者と引用元を添える', () => {
    const text = tweetText({
      id: '1',
      name: '表示名',
      handle: 'u',
      text: '本文',
      quoted: { text: '引用元', handle: 'q' },
    });

    expect(text).toContain('表示名(@u) のポスト:');
    expect(text).toContain('本文');
    expect(text).toContain('引用元(@q): 引用元');
  });

  it('作者が分からなくても組み立てられる', () => {
    expect(authorLabel({})).toBeUndefined();
    expect(tweetText({ id: '1', text: '本文' })).toBe('本文');
  });
});
