import costs


def test_tool_faults_named_by_the_stage_itself_are_recognized_in_any_stage():
    found = lambda text: costs.TOOL_MARKERS.findall(text)
    assert found('all 10 machine proof goals are capability-blocked because no Go proof adapter is available')
    assert found('Final independent verification was BLOCKED because the supplied run lacked specart-validate, preventing')
    assert not found('Independent SpecArt verification returned REPAIR_REQUIRED because accepted behavior contracts were absent')
