/// <reference path="../pb_data/types.d.ts" />
// Migration to fix Hertz Car Sales logo - use self-hosted logo
migrate((app) => {
    const collection = app.findCollectionByNameOrId("dealers")
    
    // Find the Hertz dealer by code
    const hertzDealer = app.findFirstRecordByData("dealers", "code", "0001")
    
    if (hertzDealer) {
        // Update with self-hosted logo (served from public folder)
        // The logo is accessible at /logos/hertz-car-sales.png relative to the app domain
        hertzDealer.set("logo", "/logos/hertz-car-sales.png")
        app.save(hertzDealer)
        console.log("Updated Hertz Car Sales logo to self-hosted path")
    } else {
        console.log("Hertz dealer not found - skipping logo update")
    }
}, (app) => {
    // Revert migration
    const hertzDealer = app.findFirstRecordByData("dealers", "code", "0001")
    if (hertzDealer) {
        hertzDealer.set("logo", "")
        app.save(hertzDealer)
    }
})
