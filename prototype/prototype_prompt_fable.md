Act as a senior frontend engineer and fantasy football strategist who has won several league championships.

I need you to write a complete, standalone, single-file HTML tool (with embedded CSS in <style> and vanilla JavaScript in <script>) that I can save as `war_room.html` and double-click to run in my browser locally with zero dependencies.

Before building the tool, do the research to put together a team that will score the most points given the requirements below. 

### Core Settings & Context
- Platform: ESPN Full-PPR
- League: 12 teams, Snake Draft
- My Draft Slot: Pick 1.01 (My turns are: 1, 24/25, 48/49, 72/73, 96/97, 120/121, etc.)
- Roster: 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 D/ST, 1 K, 7 Bench
### Key Features Required
1. Header & Live Draft Tracker:
   - "Current Pick" counter that increments with each drafted player.
   - Indicator showing: "Picks until your next turn" (e.g., at Pick 2, displays "22 picks until your turn at 24").
   - Quick "Drafted by Me" vs "Drafted by Others" buttons.
2. Tiered War Room Dashboard (Main View):
   - Categorized columns/cards for QB, RB, WR, TE.
   - Subdivided into clear visual tiers (Tier 1, Tier 2, Tier 3, Tier 4, Sleepers/Late).
   - Pre-populate the tiers with a realistic top-100+ PPR consensus list for the upcoming season.
   - Each player card shows: Name, Team, Bye Week, and Position Rank.
   - Clicking a player toggles them as "Taken" (fades them out and strikes through their name).
   - Right-clicking or clicking a dedicated "+ Mine" button adds them to "My Roster".
3. My Roster Sidebar:
   - Slots for 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 D/ST, 1 K, and Bench spots.
   - Automatically populates as I draft players to my team.
   - Shows positional counts so I immediately know roster deficiencies during the turn.
4. Quick Controls:
   - Search bar to instantly find and strike through any player.
   - "Undo Last Pick" button.
   - "Reset Draft" button (with confirmation prompt).
   - LocalStorage persistence so refreshing the browser won't wipe live draft progress.
5. UI / Styling:
   - Modern dark mode aesthetic (slate/charcoal background, clean contrasting colors per position: green for RB, blue for WR, red for QB, orange for TE).
   - High information density designed for a 1080p or 1440p monitor without needing excessive scrolling.

6. Additional elements:

* ADP Value Indicator Matrix: Every player card must display their ESPN Default Rank alongside their Expert Consensus Ranking (ECR).
   * If a player's ESPN rank is 10+ spots lower than ECR, flag them with a prominent Green Spark Tag (e.g., `+12 Value Value`). This tells you they are heavily buried on ESPN's interface, allowing you to confidently pass on them at Pick 24 and scoop them at Pick 25 instead.
   * If their ESPN rank is 10+ spots higher than ECR, flag them with a Red Warning Tag (e.g., `-14 Reach Risk`). This tells you that the ESPN room considers them a reach, meaning they will definitely not survive the 22-pick turn back to you.
* Dynamic Bye-Week Conflict Matrix: In your roster sidebar tracker, when a player is officially drafted to your team, their bye week must clear into an array. If you attempt to draft another starting player at the same position (or FLEX) with an identical bye week, the card must flash a brief visual alert and append a `⚠️ Bye Conflict` warning badge next to their name in your roster preview.


Please output only the raw, complete HTML file ready to save and run. Let me know if you have any questions or if there is anything else I should be concerned with. The goal is to win the league this year.