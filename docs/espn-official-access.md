# Official ESPN access

What exists for connecting to ESPN Fantasy officially, what everyone does instead, and the risk War Room carries. Researched for APE-296 on 2026-10-06.

## Short version

There is no official way in. ESPN retired its public developer API in 2014 and has no fantasy OAuth, API key or partner program that third parties can sign up for. Every product that syncs private ESPN leagues does what War Room does: it gets the user's own `espn_s2` and `SWID` cookies once and stores them encrypted on its own servers. FantasyPros, for example, collects them with a Chrome extension. The stable path is a business relationship with ESPN, not an API.

## What exists

- **No public developer program.** ESPN's developer center and API keys were shut down in 2014 ([TechCrunch, 2012 launch](https://techcrunch.com/2012/03/05/espn-developer-center-and-apis); [publicapis.io](https://publicapis.io/espn-sports-api)).
  - The `site.api.espn.com` and `lm-api-reads.fantasy.espn.com` endpoints are the ones ESPN's own site and apps use.
  - They're undocumented and change without notice.
- **Private leagues need the user's cookies.** Without them, ESPN returns `401 AUTH_LEAGUE_NOT_VISIBLE` (see [espn-protocol.md §8](espn-protocol.md)).
  - There's no token a user can grant to a third party, and no scope narrower than "the whole account".
- **No announced fantasy data partners.** We found no partnership giving a third party sanctioned access to ESPN fantasy league data. ESPN's announced partnerships are on the betting side (DraftKings).

## What everyone else does

- **FantasyPros:** since a 2020 ESPN change, ESPN sync needs its Chrome extension, and "an encrypted ESPN cookie is securely stored on FantasyPros' servers and is used to periodically sync your ESPN league" ([FantasyPros support](https://support.fantasypros.com/hc/en-us/articles/360051313453-How-do-I-add-my-ESPN-fantasy-league-to-my-account-Why-do-I-need-your-browser-extension-to-sync-my-league)).
- **Others:** Flock, FantasySP, Fantasy Life, PFF and The Fantasy Footballers all offer ESPN league sync ([Flock extension](https://chromewebstore.google.com/detail/flock-fantasy-league-sync/iphbmofabopjekdpkdmpehlhoamheigo), [FantasySP](https://www.fantasysp.com/fantasy-sync-help), [Fantasy Life](https://www.fantasylife.com/articles/fantasy/how-to-sync-your-fantasy-football-leagues-with-fantasy-hq), [PFF](https://profootballfocussupport.zendesk.com/hc/en-us/articles/32404432940563-How-do-I-sync-my-fantasy-league-Why), [Footballers](https://help.thefantasyfootballers.com/en/articles/3156929)).
  - Where they explain how, it's an extension or the same cookie hand-off.
- **Desktop-first:** where the tool uses a browser extension, the first connection needs desktop Chrome. War Room's bookmark plus same-tab claim (APE-254) is meant to work in a phone browser too.

## What the terms say

These quotes are from the [Disney Terms of Use](https://disneytermsofuse.com/english/), which cover ESPN:

- **§2.B.x** prohibits access "using a robot, spider, script, or other automated means, including … data mining or web scraping or otherwise compiling … any collection of data".
- **§1.F:** users "will not share your account or account information with others".
- **§1.E:** no "using another person's username, password or other account information".

## The risk War Room carries

The whole category runs against these terms. War Room reading a user's leagues with their cookies, and writing lineup changes when they confirm, is automated access with shared account information.

The practical risks:
- ESPN changes its endpoints or cookie handling. This has happened before: FantasyPros' 2020 switch to an extension.
- ESPN blocks server traffic.
- In the worst case, ESPN objects to the product.

Things that keep the risk down, all already true:
- The user's own login, used only for their own leagues.
- No passwords handled.
- Writes only on explicit confirmation.
- Credentials deleted at season end or on disconnect.
- Unofficial status disclosed in the consent text (`src/lib/espn/disclosure.ts`).

Things we've ruled out because they'd raise it: signing in to Disney on the user's behalf, handling ESPN passwords, and anything that works around ESPN's bot checks.

## A stable path: ask ESPN

The only sanctioned route would be a direct agreement with ESPN Fantasy (business development or partnerships at ESPN/Disney). It's worth one short note once War Room has users to point to. Draft for Greg to adapt and send:

> **Subject:** Fantasy War Room: partnering on ESPN league access
>
> Hi, I run Fantasy War Room (draftroom.online), a draft and in-season assistant for fantasy football. Many of our users play on ESPN, and today they connect their leagues the way most fantasy tools do, by sharing their own ESPN session with us. We'd rather do this properly. Is there a partner program or sanctioned API for reading a user's own league (rosters, settings, matchups) and, with their confirmation, setting their lineup? We'd happily work within whatever scopes, rate limits and branding rules you set, and send users back to ESPN to manage their teams. Who's the right person to talk to?
>
> Greg Farrenkopf, Apeman Tech

There's no public contact for this. Likely routes are a LinkedIn search for ESPN Fantasy product or partnerships, or the Disney Advertising/ESPN business development contact forms.
