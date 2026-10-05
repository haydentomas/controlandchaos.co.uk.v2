begin;

insert into public.directory_profiles (
  slug, display_name, sl_username, role_type, headline, tagline, about,
  starting_rate, availability, tags, is_approved, is_published
)
values
  (
    'demo-dominant', 'Demo Dominant', 'demo-not-a-real-dom', 'domme',
    'Development sample listing', 'Sample profile for testing directory filters.',
    'This is a development-only sample, not a real creator or verified avatar.',
    'Demo only', 'available', array['FinDom', 'RLV'], true, true
  ),
  (
    'demo-submissive', 'Demo Submissive', 'demo-not-a-real-sub', 'sub',
    'Development sample listing', 'Sample profile for testing public profile navigation.',
    'This is a development-only sample, not a real creator or verified avatar.',
    'Demo only', 'away', array['VIP'], true, true
  ),
  (
    'demo-unpublished-control', 'Unpublished Demo Control', 'demo-not-a-real-control', 'switch',
    'Must not appear publicly', 'Unpublished access-control test record.',
    'Development-only hidden control record. It must not be returned to anonymous readers.',
    'Demo only', 'offline', array['RLV'], false, false
  )
on conflict (slug) do nothing;

commit;