// The browser side of On the Clock. The page carries its data in `window.ON_THE_CLOCK`
// (one entry per league, plus whether live sync is on); everything on screen is derived
// from it here. Global styles first, so the modules the components import layer on top.
import "./styles/tokens.css";
import "./styles/base.css";
import { render } from "preact";
import { App } from "./app/App.jsx";

render(<App data={window.ON_THE_CLOCK} />, document.getElementById("app"));
