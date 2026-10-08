# Customize your profile icon

Open Community → Your community profile. Choose an icon and background color, check the preview, then select Save profile. Choose Initials to return to a name-based icon.

Icons appear in the account header, comments, chat, mentions, and member leaderboards. Participation badges remain automatic and separate from the customizable icon. Your choice is saved to your account and works across devices.

Deployment applies migration `0030_profile_icons_20261008.sql` before publishing the Worker. Existing members default to initials with a teal background. Only the authenticated member can change their own icon through the profile form.
