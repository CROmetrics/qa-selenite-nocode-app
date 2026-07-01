# Originally created and developed by William Wiley. Forked for Cro Metrics.

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
import time

def open_url(driver, url):
    """Opens the specified URL in the current browser window."""
    driver.get(url)

def get_current_url(driver):
    """Returns the URL of the current loaded page."""
    return driver.current_url

def get_title(driver):
    """Fetches the title of the current webpage."""
    return driver.title

def back(driver):
    """Navigates back in browser history."""
    driver.back()

def forward(driver):
    """Navigates forward in browser history."""
    driver.forward()

def refresh(driver):
    """Reloads the current page."""
    driver.refresh()

def maximize_window(driver):
    """Maximizes the browser window."""
    driver.maximize_window()

def minimize_window(driver):
    """Minimizes the browser window."""
    driver.minimize_window()

def implicit_wait(driver, seconds):
    """Sets an implicit wait to delay element lookups by a specified time (in seconds)."""
    driver.implicitly_wait(float(seconds))

def explicit_wait(driver, css_selector, timeout):
    """Waits until an element specified by a CSS selector is present (uses explicit wait)."""
    WebDriverWait(driver, float(timeout)).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, css_selector))
    )

def click_by_id(driver, element_id):
    """Clicks an element found by its HTML ID attribute."""
    driver.find_element(By.ID, element_id).click()

def click_by_name(driver, name):
    """Clicks an element using its name attribute."""
    driver.find_element(By.NAME, name).click()

def click_by_xpath(driver, xpath):
    """Clicks an element using its XPath."""
    driver.find_element(By.XPATH, xpath).click()

def click_by_css(driver, css):
    """Clicks an element using its CSS selector."""
    driver.find_element(By.CSS_SELECTOR, css).click()

def click_by_link_text(driver, text):
    """Clicks a link using the visible link text."""
    driver.find_element(By.LINK_TEXT, text).click()

def fill_by_id(driver, element_id, text):
    """Fills an input element using its ID with the provided text."""
    el = driver.find_element(By.ID, element_id)
    el.clear()
    el.send_keys(text)

def fill_by_name(driver, name, text):
    """Fills an input field using its name attribute."""
    el = driver.find_element(By.NAME, name)
    el.clear()
    el.send_keys(text)

def fill_by_xpath(driver, xpath, text):
    """Fills an input using its XPath."""
    el = driver.find_element(By.XPATH, xpath)
    el.clear()
    el.send_keys(text)

def fill_by_css(driver, css, text):
    """Fills an input using a CSS selector."""
    el = driver.find_element(By.CSS_SELECTOR, css)
    el.clear()
    el.send_keys(text)

def submit_by_id(driver, element_id):
    """Submits a form using its ID."""
    driver.find_element(By.ID, element_id).submit()

def submit_by_xpath(driver, xpath):
    """Submits a form found by its XPath."""
    driver.find_element(By.XPATH, xpath).submit()

def select_by_name(driver, name, value):
    """Selects a dropdown option by value using the 'name' attribute."""
    Select(driver.find_element(By.NAME, name)).select_by_value(value)

def send_keys_action(driver, keys_sequence):
    """Sends keyboard input to the currently focused element."""
    driver.switch_to.active_element.send_keys(keys_sequence)

def switch_to_frame_by_name(driver, frame_name):
    """Switches context to a frame using its name or ID."""
    driver.switch_to.frame(frame_name)

def switch_to_default_content(driver):
    """Switches context back to the main page (exits frames)."""
    driver.switch_to.default_content()

def switch_to_parent_frame(driver):
    """Switches to the parent frame from a nested frame."""
    driver.switch_to.parent_frame()

def switch_to_window(driver, handle_or_name):
    """Switches to a different browser window using its handle or name."""
    driver.switch_to.window(handle_or_name)

def accept_alert(driver):
    """Accepts a browser alert popup."""
    driver.switch_to.alert.accept()

def dismiss_alert(driver):
    """Dismisses a browser alert popup."""
    driver.switch_to.alert.dismiss()

def get_alert_text(driver):
    """Returns the text message from the currently open alert popup."""
    return driver.switch_to.alert.text

def wait_seconds(driver, seconds):
    """Pauses execution for a set number of seconds."""
    time.sleep(float(seconds))

def close_browser(driver):
    """Closes the browser and ends the WebDriver session."""
    driver.quit()
