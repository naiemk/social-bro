import React from "react";
import { panels } from "../../../frontend/index";

describe("PanelComponent Tests", () => {
  // Get the Panel component from the exported panels
  const PanelComponent = panels[0]?.component;

  describe("Panel Registration", () => {
    it("should export panels array with correct structure", () => {
      expect(panels).to.be.an("array");
      expect(panels).to.have.length.greaterThan(0);

      const panel = panels[0];
      expect(panel).to.have.property("name", "Dashboard");
      expect(panel).to.have.property("path", "dashboard");
      expect(panel).to.have.property("component");
      expect(panel).to.have.property("icon", "LayoutDashboard");
      expect(panel).to.have.property("public", false);
      expect(panel).to.have.property("shortLabel", "Dash");
    });
  });

  describe("Component Rendering", () => {
    it("should render with agent ID", () => {
      const testAgentId = "test-agent-12345";

      if (!PanelComponent) {
        throw new Error("PanelComponent not found in panels export");
      }

      cy.mount(<PanelComponent agentId={testAgentId} />);

      cy.contains("Sign in").should("be.visible");
    });

    it("should handle different agent IDs", () => {
      const agentIds = [
        "agent-1",
        "agent-2",
        "12345678-1234-1234-1234-123456789abc",
        "test-agent",
      ];

      agentIds.forEach((agentId) => {
        cy.mount(<PanelComponent agentId={agentId} />);
        cy.contains("Sign in").should("be.visible");
      });
    });

    it("should render without crashing with empty agent ID", () => {
      cy.mount(<PanelComponent agentId="" />);
      cy.contains("Sign in").should("be.visible");
    });
  });
});
