# Publication likes: technical source acceptance

PR866 candidate `d90a263acfa43d129eb161971d377b0f46b0f9e7` merged as
`388a60ee8dc8bd49a12aaec2bd9f35defd910dda`. Independent exact Code and Security
reviews PASS. Owner approved retention in DEC122 on 30 October 2026.

## Verified gates

- General41037641010: all four jobs SUCCESS. Data8770 PASS,11 existing explicit
  skips;16 extension checks PASS. Access A and account settings/browser layouts PASS.
- PublicProjects41037641744:544 publication PG/API/UI checks,51 creator checks,
  four upgrade checks and24 actual built-browser cases PASS. Counts overlap
  across gates and must not be summed as unique tests.
- Exact built Web metadata identifies the candidate SHA. Actual screenshots and
  receipts are in artifact `public-projects-d90a263acfa43d129eb161971d377b0f46b0f9e7`,
  including Account1440,Seat390,admin1024 and moderation320/390/1024/1440.
- Local affected checks:87 initial units,23 guest/public units and21 admin-refresh
  units passed in their corresponding bounded changes. Missing local generated
  identity declarations were treated as infrastructure; no dependency relink/install.

## Result

One compact Like and server count for an active Account or StudentSeat, with
server identity/session checks, no self-like and linked-identity duplicate checks.
Publish/download/master permissions do not disable viewing or likes. Retain
likes through update,withdrawal and republishing. Admin OFF prevents new likes
but permits removing an existing own like. Hidden/unknown unlike responses are
minimal and do not reveal publication details or other reactors.

Extend the existing reaction table with a canonical target namespace; old Gallery
like/wow rows and collection links are preserved,not transferred. Restricted
runtime RLS cannot read canonical reactor rows. Public counts and private
no-store actor state stay separate. No ratings or AI bonus accounting.

Admin Publications exposes real counts and reason/CAS/audited reaction controls.
A successful authoritative full list refresh updates counts and restores controls
after a failed write at the same revision/version. Loading,failed refresh,typing,
ordinary render and pagination do not reset the form. Actual browser tests change
likes1→0→1 and verify the refresh button.

## Corrections qualified before acceptance

Real PG caught a missing persisted school Seat/Account link in a new fixture;
normal proof was seeded without weakening identity guards. Browser checks caught
anonymous private requests causing401/session-refresh churn; the existing resolved
App session now gates private requests. API-seeded browser actors use normal
reload/bootstrap. Actual1024 admin overflow was fixed with shrinking/wrapping
actions,not hidden overflow. Forward-upgrade expected lists include0283 while
historical data checks remain strict. Automatic review caught stale admin child
state after list refresh; the accepted list epoch and real component/browser
regressions qualify its fix. All prior failures are superseded by the exact green
gates above; no CI waiver,timeout increase,test skip or assertion weakening.

Migration0283 normalized LF SHA256:
`a2b61c7e1f187d8fc466590e82ab02f0fb2628cd9d56d666367d58da7d2bb5af`.

This is source acceptance only. No working database/site update,5000-user load
qualification,native3D public-player acceptance or owner visual acceptance.
Scratch asset-copy and physical file export remain separate unfinished slices.
