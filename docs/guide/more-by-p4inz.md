---
title: "More by P4inz"
layout: default
description: "Atharva Patil (p4inz, P4INZ, painz), P4inz Interactive Labs: the portfolio, GitHub, and every project, filterable by tag."
---

# More by P4inz

Kanvaz is made by {{ site.data.studio.person }}, also written p4inz, P4INZ and painz, under P4inz Interactive Labs (earlier Northbyte Studios). This page links the other sites and every project, so you can reach any of them from here.

<div class="p-links" markdown="0">
<a href="{{ site.data.studio.portfolio }}"><b>Portfolio</b><span>atharvapatil.tech</span></a>
<a href="{{ site.data.studio.github }}"><b>GitHub</b><span>p4inz-code</span></a>
<a href="{{ site.data.studio.linkedin }}"><b>LinkedIn</b><span>in/p4inz</span></a>
<a href="{{ site.data.studio.discord }}"><b>Discord</b><span>Kanvaz community</span></a>
<a href="{{ site.data.studio.donate }}"><b>Support</b><span>Donate page</span></a>
<a href="{{ site.data.studio.npm }}"><b>npm</b><span>~p4inz-code</span></a>
</div>

## Projects

<div class="chips" id="chips" aria-label="Filter projects by tag" markdown="0"></div>

<div class="proj" id="proj" markdown="0">
{% for p in site.data.studio.projects %}<article class="proj-card" data-tags="{{ p.tags | join: '|' }}">
<h3>{{ p.name }}</h3>
<p>{{ p.line }}</p>
<ul class="tag-row">{% for t in p.tags %}<li>{{ t }}</li>{% endfor %}</ul>
<div class="proj-links">{% if p.url %}<a href="{{ p.url }}">Open</a>{% endif %}{% if p.site %}<a href="{{ p.site }}">Case study</a>{% endif %}<a href="{{ p.repo }}">Source</a></div>
</article>
{% endfor %}</div>
