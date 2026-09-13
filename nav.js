/* nav.js for the Team Portal. Seeded from the page menu on 2026-09-13 by Claude.
   The Site Admin hub (cw-admin-hub/site-admin.html) republishes this file; do not edit by hand.
   The page keeps its own markup as a fallback if this file is missing or malformed. */
window.CW_NAV = {
 "hub": "portal",
 "label": "Team Portal",
 "menu": [
  {
   "label": "Site Admin",
   "style": "strip",
   "href": "https://citywidelv.github.io/cw-admin-hub/site-admin.html",
   "note": "Menus, lists and the live email switches for every hub. Site Admin passcode required."
  },
  {
   "label": "Building Information Sheets",
   "items": [
    {
     "label": "Browse the Sheet Library",
     "href": "https://citywidelv.github.io/cw-ops-desk/building-sheets.html"
    },
    {
     "label": "New / Update a Sheet",
     "href": "https://citywidelv.github.io/cw-ops-desk/building-sheet.html"
    }
   ],
   "note": "One living DBIS per account: access, schedule, alarms, locations, tenants, photos.",
   "style": "dbis"
  },
  {
   "label": "Team & Admin",
   "items": [
    {
     "ghead": "CRM & Billing"
    },
    {
     "label": "Open CW Sales CRM",
     "href": "https://gocitywide.crm.dynamics.com/main.aspx"
    },
    {
     "label": "Create a Supply Invoice",
     "href": "https://supplysales.powerappsportals.com/SignIn?ReturnUrl=%2FCustomer-Select%2F"
    },
    {
     "label": "Request a Supply Item",
     "href": "https://form.jotform.com/tjroberts/supply-item-request-for-field-sales"
    },
    {
     "label": "Create an Extra Charge",
     "href": "https://apps.powerapps.com/play/e/58e2128b-deac-e675-8cd1-7d879ca63711/a/a052bc89-2125-4efd-88e5-682f1d2dbcd0?tenantId=3b214a92-dd33-4a9c-a070-43f6783d144c&hint=a842db25-40d4-46c0-b151-6ad085ee7345&sourcetime=1756059511414&source=portal"
    },
    {
     "ghead": "Team"
    },
    {
     "label": "Asana",
     "href": "https://app.asana.com/"
    },
    {
     "label": "Employee Uniforms",
     "href": "https://citywidelv.github.io/cw-ops-desk/uniforms.html"
    },
    {
     "label": "ADP TotalSource",
     "href": "https://workforcenow.adp.com/"
    },
    {
     "label": "Order CW Merch",
     "href": "https://cwlv.printful.me/"
    },
    {
     "label": "Team Emails by Position",
     "href": "https://citywidelv.github.io/cw-admin-hub/team-emails.html"
    },
    {
     "ghead": "Team Apps"
    },
    {
     "label": "Slack",
     "href": "https://slack.com/signin"
    },
    {
     "label": "Microsoft Bookings",
     "href": "https://bookings.cloud.microsoft/bookings/homepage"
    },
    {
     "label": "Jotform",
     "href": "https://www.jotform.com/myforms/"
    },
    {
     "label": "ZoomInfo",
     "href": "https://app.zoominfo.com/"
    },
    {
     "label": "CW Score Cloud",
     "href": "https://cwfscorecloud.gocitywide.com/login"
    },
    {
     "label": "City Wide YOU (Training)",
     "href": "https://gocitywide.docebosaas.com/pages/19/city-wide-you"
    },
    {
     "ghead": "Supplier Ordering"
    },
    {
     "label": "Order More EnvirOx",
     "href": "https://citywidelv.github.io/cw-ops-desk/envirox.html"
    },
    {
     "label": "Brady Industries",
     "href": "https://www.bradyindustries.com/"
    },
    {
     "label": "Staples Advantage",
     "href": "https://www.staplesadvantage.com/"
    },
    {
     "label": "HD Supply Solutions",
     "href": "https://hdsupplysolutions.com/"
    },
    {
     "label": "Amazon Business",
     "href": "https://www.amazon.com/business"
    },
    {
     "label": "City Wide Company Store",
     "href": "https://shopcitywide.mybrightsites.com/"
    }
   ],
   "note": "Also available on the Ops Hub."
  }
 ]
};
