-- =====================================================================
-- MILEO — Course: Kitchen English (A2)
--
-- HOW TO RUN (once):
--   Supabase → SQL Editor → + → Create a new snippet → paste → Run.
--   Safe to run twice: anything already there is left as it is.
--
-- WHAT IT ADDS
--   Programme KE-A2 "Kitchen English", UNPUBLISHED (students can't see it
--   until you tick Published in Admin → Programmes).
--   4 modules, 10 can-do skills (one per lesson), from the London
--   Language School's own Kitchen English for chefs course (L1–L10).
--   One checkpoint per module is booked later from Admin.
-- =====================================================================

begin;

insert into public.programmes (language_code, code, title, cefr_level, description, published)
values ('en', 'KE-A2', 'Kitchen English', 'A2',
        'English for chefs and kitchen staff: the team, equipment, ingredients, commands, cooking, safety, allergens and a busy service. 10 lessons, 4 checkpoints.',
        false)
on conflict (code) do nothing;

insert into public.modules (programme_id, position, title, summary)
select p.id, m.position, m.title, m.summary
from public.programmes p
cross join (values
  (1, 'My kitchen',   'The team, the equipment and the ingredients.'),
  (2, 'Prep & cook',  'Commands, cooking methods, weights, temperatures and times.'),
  (3, 'Safe kitchen', 'Health and safety rules, allergens and diets.'),
  (4, 'Service!',     'Calls at the pass, a busy service and what went wrong.')
) as m(position, title, summary)
where p.code = 'KE-A2'
on conflict (programme_id, position) do nothing;

insert into public.skills (code, can_do, area, cefr_level) values
  ('KE-A2.L01', 'Can introduce yourself and the kitchen team',                 'speaking',   'A2'),
  ('KE-A2.L02', 'Can name kitchen equipment and say where it is',              'vocabulary', 'A2'),
  ('KE-A2.L03', 'Can check a delivery: say what there is and ask for some or any', 'speaking', 'A2'),
  ('KE-A2.L04', 'Can give and follow kitchen commands',                        'listening',  'A2'),
  ('KE-A2.L05', 'Can explain how to cook a dish, step by step',                'speaking',   'A2'),
  ('KE-A2.L06', 'Can say and understand weights, temperatures and times',      'vocabulary', 'A2'),
  ('KE-A2.L07', 'Can explain kitchen safety rules with must and mustn''t',     'speaking',   'A2'),
  ('KE-A2.L08', 'Can answer customers'' questions about allergens and diets',  'speaking',   'A2'),
  ('KE-A2.L09', 'Can make and understand calls at the pass during service',    'listening',  'A2'),
  ('KE-A2.L10', 'Can say what went wrong in a shift and ask for help',         'speaking',   'A2')
on conflict (code) do nothing;

insert into public.module_skills (module_id, skill_id)
select m.id, s.id
from public.programmes p
join public.modules m on m.programme_id = p.id
join (values
  (1, 'KE-A2.L01'), (1, 'KE-A2.L02'), (1, 'KE-A2.L03'),
  (2, 'KE-A2.L04'), (2, 'KE-A2.L05'), (2, 'KE-A2.L06'),
  (3, 'KE-A2.L07'), (3, 'KE-A2.L08'),
  (4, 'KE-A2.L09'), (4, 'KE-A2.L10')
) as link(position, skill_code) on link.position = m.position
join public.skills s on s.code = link.skill_code
where p.code = 'KE-A2'
on conflict do nothing;

-- Quick check: should show 4 modules and 10 skills.
select (select count(*) from public.modules m join public.programmes p on p.id = m.programme_id where p.code = 'KE-A2') as modules,
       (select count(*) from public.module_skills ms join public.modules m on m.id = ms.module_id
          join public.programmes p on p.id = m.programme_id where p.code = 'KE-A2') as skills;

commit;
