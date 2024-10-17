---
# Documentation: https://wowchemy.com/docs/managing-content/

title: "Neighborhood-Level Air Quality and Equity Assessment in Washington D.C. through Advanced Modeling and Policy Analysis"
summary: ""
authors: ["admin", "hhallaji"]
tags: ["climate", "environmental justice", "exposure modeling", "air quality modeling", "research co-development"]
categories: []
date: 2024-10-16T13:45:21-04:00

# Optional external URL for project (replaces project detail page).
external_link: ""

# Featured image
# To use, add an image named `featured.jpg/png` to your page's folder.
# Focal points: Smart, Center, TopLeft, Top, TopRight, Left, Right, BottomLeft, Bottom, BottomRight.
# image:
#   caption: ""
#   focal_point: ""
#   preview_only: false

# Custom links (optional).
#   Uncomment and edit lines below to show custom links.
# links:
# - name: Follow
#   url: https://twitter.com
#   icon_pack: fab
#   icon: twitter

url_code: ""
url_pdf: ""
url_slides: ""
url_video: ""

# Slides (optional).
#   Associate this project with Markdown slides.
#   Simply enter your slide deck's filename without extension.
#   E.g. `slides = "example-slides"` references `content/slides/example-slides.md`.
#   Otherwise, set `slides = ""`.
slides: ""
---


This project is part of the REACH Center’s NIH-funded initiative and emphasizes the importance of environmental justice, providing insights to support decision-makers in improving air quality and reducing disparities across different communities. It centers on assessing the health and equity impacts of transportation-related emissions in the Washington, D.C. metropolitan area, focusing on how road pricing policies can mitigate air pollution and improve public health outcomes. Road pricing, a climate change mitigation strategy, aims to reduce traffic-related air pollution (TRAP) by lowering vehicular emissions, which contribute to high levels of nitrogen dioxide (NO2), fine particulate matter (PM2.5), and ozone (O3) in the city. The study is particularly concerned with the disproportionate exposure to pollutants faced by low-income and racially marginalized communities, such as those in Southeast D.C., where morbidity and mortality rates related to air pollution are significantly higher than in wealthier, predominantly white areas. To achieve its objectives, the project integrates fine-scale transportation, air quality, and health outcomes models to quantify neighborhood-level impacts of proposed road pricing schemes. This data-driven approach leverages the power of novel geospatial datasets to explore environmental justice, helping inform policymakers about potential benefits and unintended consequences of these strategies.

Using the Community Multiscale Air Quality (CMAQ v5.4+) model, we employ a high-resolution 1 km<sup>2</sup> grid over approximately 1,500 km<sup>2</sup> of the region to capture detailed meteorological and chemical dynamics. Supported by meteorological data from the Weather Research and Forecasting (WRF) model and emissions data processed by the Sparse Matrix Operator Kernel Emissions (SMOKE) model, our study focuses on understanding the localized effects of vehicular emissions, particularly in response to road pricing and other regulatory strategies. By analyzing pollution levels at the neighborhood scale, we aim to quantify health and equity outcomes, ensuring that policy decisions lead to more sustainable and equitable urban environments. 

{{< figure library="true" src="featured.png" title=" CMAQ model domain setup showing WRF meteorological model output of temperature over Washington, DC." numbered="true" lightbox="true" >}}
