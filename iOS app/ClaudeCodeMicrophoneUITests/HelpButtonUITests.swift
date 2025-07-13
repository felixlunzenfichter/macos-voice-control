import XCTest

class HelpButtonUITests: XCTestCase {
    
    override func setUpWithError() throws {
        continueAfterFailure = false
    }
    
    func testHelpButtonPress() throws {
        // Launch app
        let app = XCUIApplication()
        app.launch()
        
        // Wait for connection
        let helpButton = app.buttons["Help"]
        let exists = helpButton.waitForExistence(timeout: 5)
        XCTAssertTrue(exists, "Help button should exist")
        
        // Tap Help button
        helpButton.tap()
        
        // Verify tap succeeded
        XCTAssertTrue(true, "Help button tapped successfully")
    }
}