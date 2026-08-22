import {
  assertFrenchSchoolRegressionGate,
  evaluateFrenchSchoolFixture,
} from "./evaluation";

assertFrenchSchoolRegressionGate();
console.log(
  JSON.stringify(
    {
      ...evaluateFrenchSchoolFixture(),
      warning:
        "Regression fixture only: no live provider was called and this is not current model-quality evidence.",
    },
    null,
    2,
  ),
);
